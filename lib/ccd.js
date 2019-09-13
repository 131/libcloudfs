"use strict";

const Storage = require('swift/storage');

const queue = require('nyks/async/queue');
const sleep = require('nyks/async/sleep');
const drain = require('nyks/stream/drain');


const {
  BIGFILE_HEADER,
  SEGMENT_MAX_AGE,
  SEGMENT_PREFIX,
  SEGMENT_CLEANUP_HEARTBEAT,
} = require('./env.json');

//CASConsolidationDaemon
class CCD {

  constructor({storage_ctx, storage_container, block_path}) {
    this.ctx        = storage_ctx;
    this.container  = storage_container;
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
    let head = await Storage.check(this.ctx, this.container, segment_name);
    if(!head)
      return; //nothing to do, really

    let segment_hash = head.headers['etag'];
    let bigfile_hash = head.headers[BIGFILE_HEADER];

    //should unlink if 'old'
    if(!bigfile_hash) {
      console.log("KILLING OLD", segment_name, head.headers);
      if(Date.now() - (new Date(head.headers['last-modified']).getTime()) > SEGMENT_MAX_AGE)
        await Storage.deleteFile(this.ctx, this.container, segment_name);
      return;
    }

    //maybe bigfile does not exists anymore => delete
    let bigfile_path = this.block_path(bigfile_hash);
    let segment_path = this.block_path(segment_hash);

    let [bigfile_head, cas_head] = await Promise.all([
      Storage.check(this.ctx, this.container, bigfile_path),
      Storage.check(this.ctx, this.container, segment_path)
    ]);

    //if bigfile does not exists or is no SLO
    if(!bigfile_head || !bigfile_head.headers['x-static-large-object']) {
      //maybe re-check etag here ?
      await Storage.deleteFile(this.ctx, this.container, segment_name);
      return;
    }

    //first, copy to cas_head if necessary, this takes time
    if(!cas_head || cas_head.headers['x-static-large-object']) {
      await Storage.put(this.ctx, this.container, segment_path, {
        headers : {
          'x-copy-from' : `${this.container}/${segment_name}`,
          'etag'        : 'this is nope',
        }
      });
    }

    //then, update bigfile
    if(bigfile_hash != segment_hash)
      await this._updateManifest(bigfile_hash);

    //finally, delete segment
    await Storage.deleteFile(this.ctx, this.container, segment_name);
  }


  //download manifest, update manifest, push manifest
  async _updateManifest(bigfile_hash, segment_hash) {
    let bigfile_path = this.block_path(bigfile_hash);

    let manifest = await Storage.download(this.ctx, this.container, "");
    let current_etag = manifest.headers.etag;
    manifest = JSON.parse(await drain(manifest));

    //segment_hash is now a valid CAS member
    for(let part of manifest) {
      if(part.etag == segment_hash)
        part.path = this.block_path(segment_hash);
    }
    //full manifest etag did not change
    await Storage.putStream(this.ctx, this.container, bigfile_path, {
      headers : {
        etag : current_etag,
      }
    });
  }

  async tick() {
    var temp = await Storage.getFileList(this.ctx, this.container, SEGMENT_PREFIX);
    for(let segment of temp)
      this.push(segment.name);
  }


}


module.exports = CCD;
