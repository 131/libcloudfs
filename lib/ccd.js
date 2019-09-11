"use strict";

const queue = require('nyks/async/queue');
const dive  = require('nyks/object/dive');

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
    this.queue     = queue(this._consolidate.bind(this));
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

    let bigfile_hash = dive(head, 'headers', BIGFILE_HEADER);

    //should unlink if 'old'
    if(!bigfile_hash) {
      console.log("KILLING OLD", head);
      process.exit();
      if(Date.now() - head.headers.date  > SEGMENT_MAX_AGE)
        await Storage.deleteFile(this.ctx, this.container, segment_name);
      return;
    }

    //maybe bigfile does not exists anymore => delete
    let bigfile_path = this.block_path(bigfile_hash);
    let cas_head     = this.block_path(segment_hash);

    let [bigfile_head, cas_head] = await Promise.all([
      Storage.check(this.ctx, this.container, bigfile_path),
      Storage.check(this.ctx, this.container, cas_head)
    ]);

console.log("Got bigfile_head", bigfile_head, "cas_head", cas_head);
process.exit();

    //if bigfile does not exists or is no SLO
    if(!bigfile_head || bigfile_head.headers['x-manifest-slo']) {
      await Storage.deleteFile(this.ctx, this.container, segment_name);
      return;
    }

    //first, copy to cas_head if necessary, this takes time
    if(!cas_head)
      await Storage.put(this.ctx, this.container, segment_name);

    //then, update bigfile
    if(bigfile_hash != cas_hash)
      await this._updateManifest(bigfile_hash);

    //finally, delete segment
    await Storage.deleteFile(this.ctx, this.container, segment_name);
  }


  //download manifest, update manifest, push manifest
  async _updateManifest(bigfile_hash, segment_hash) {
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
    console.log("got files list for tick", temp);
    process.exit();
    for(let segment of temp)
      this.push(temp);
  }


}


module.exports = CCD;
