"use strict";

const Storage = require('swift/storage');

const queue = require('nyks/async/queue');
const sleep = require('nyks/async/sleep');
const drain = require('nyks/stream/drain');
const md5   = require('nyks/crypto/md5');

const {
  BIGFILE_HEADER,
  SEGMENT_MAX_AGE,
  SEGMENT_PREFIX,
  SEGMENT_CLEANUP_HEARTBEAT,
} = require('./env.json');

//CASConsolidationDaemon
class CCD {

  constructor({storage_ctx, storage_container, block_path}) {
    this.storage_ctx        = storage_ctx;
    this.storage_container  = storage_container;
    this.block_path = block_path;
    this.queue     = queue(async (task) => {
      try {
        await this._consolidate(task);
      } catch(err) {
        console.log("TOJS IS ERR", err);
      }
    });
  }

  async run() {
    do {
      await sleep(SEGMENT_CLEANUP_HEARTBEAT);
      await this.tick();
    } while(true);
  }

  push(segment_name) {
    this.queue.push(segment_name);
  }

  async _consolidate(segment_name) {
    let head = await Storage.check(this.storage_ctx, this.storage_container, segment_name);
    if(!head)
      return; //nothing to do, really

    let segment_hash = head.headers['etag'];
    let bigfile_hash = head.headers[BIGFILE_HEADER];

    //should unlink if 'old'
    if(!bigfile_hash) {
      console.log("KILLING OLD", segment_name, head.headers);
      if(Date.now() - (new Date(head.headers['last-modified']).getTime()) > SEGMENT_MAX_AGE)
        await Storage.deleteFile(this.storage_ctx, this.storage_container, segment_name);
      return;
    }

    //maybe bigfile does not exists anymore => delete
    let bigfile_path = this.block_path(bigfile_hash);
    let segment_path = this.block_path(segment_hash);

    let [bigfile_head, cas_head] = await Promise.all([
      Storage.check(this.storage_ctx, this.storage_container, bigfile_path),
      Storage.check(this.storage_ctx, this.storage_container, segment_path)
    ]);

    //if bigfile does not exists or is no SLO
    if(!bigfile_head || !bigfile_head.headers['x-static-large-object']) {
      //maybe re-check etag here ?
      await Storage.deleteFile(this.storage_ctx, this.storage_container, segment_name);
      return;
    }

    //first, copy to cas_head if necessary, this takes time
    if(!cas_head || cas_head.headers['x-static-large-object']) {
      await Storage.put(this.storage_ctx, this.storage_container, segment_path, {
        headers : {
          'x-copy-from' : `${this.storage_container}/${segment_name}`,
          'etag'        : 'this is nope',
        }
      });
    }

    //then, update bigfile
    if(bigfile_hash != segment_hash) //we KNOW bigfile to be a manifest
      await this._updateManifest(bigfile_hash, segment_hash);

    //finally, delete segment
    await Storage.deleteFile(this.storage_ctx, this.storage_container, segment_name);
  }


  //download manifest, update manifest, push manifest
  async _updateManifest(bigfile_hash, segment_hash) {

    let bigfile_path = this.block_path(bigfile_hash);
    let manifest = await Storage.download(this.storage_ctx, this.storage_container, `${bigfile_path}?multipart-manifest=get`);
    let segment_fullpath = `${this.storage_container}/${this.block_path(segment_hash)}`;
    let manifest_body = JSON.parse(await drain(manifest));
    //segment_hash is now a valid CAS member
    manifest_body = manifest_body.map(({hash, name, bytes})  => ({
      "path"       : hash == segment_hash ? segment_fullpath : name,
      "size_bytes" : bytes,
      "etag"       : hash,
    }));
    var etag = md5(manifest_body.map(line => line.etag).join('')); //no changes

    //full manifest etag did not change
    var remote_url = `${bigfile_path}?multipart-manifest=put`;
    let res = await Storage.putStream(this.storage_ctx, Buffer.from(JSON.stringify(manifest_body)), this.storage_container, remote_url, {etag});
    console.log(res.statusCode, manifest_body);
  }

  async tick(wait) {
    var temp = await Storage.getFileList(this.storage_ctx, this.storage_container, SEGMENT_PREFIX);
    for(let segment of temp) {
      if(wait)
        await this._consolidate(segment.name);
      else
        this.push(segment.name);
    }
  }


}


module.exports = CCD;
