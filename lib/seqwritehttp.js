"use strict";

/**
* Write an http stream sequentialy (at non random offset)
* with large file (swift style manifest) support
*/

const https  = require('https');
const crypto = require('crypto');
const bl     = require('bl');
const url    = require('url');


const debug   = require('debug');
const Storage = require('swift/storage');
const md5     = require('nyks/crypto/md5');
const guid    = require('mout/random/guid');
const sprintf = require('util').format;

const logger = {
  error : debug('seqwritehttp:error'),
  debug : debug('seqwritehttp:debug'),
  info  : debug('seqwritehttp:info'),
};


const {
  BIGFILE_HEADER, BIGFILE_SPLIT,
  SEGMENT_PREFIX,
  MIME_LARGE,
} = require('./env.json');


class SeqWriteFile {
  constructor({storage_ctx, storage_container, block_path}) {
    this.storage_ctx       = storage_ctx;
    this.storage_container = storage_container;
    this.block_path        = block_path;

    this.parts = [];
  }

  async close() {
    if(!this.part_fd)
      return;

    this._close_part();

    let block_hash = this.block_hash.digest("hex");
    let block_path = this.block_path(block_hash);
    let block_size = this.parts.reduce((acc, part) => (acc += part.part_size, acc), 0);

    logger.debug("Got content hash", block_hash, block_path, this.parts, block_size);

    //maybe destination already exists
    let final_check = await Storage.check(this.storage_ctx, this.storage_container, block_path);

    if(!final_check)
      await this._register_manifest(block_hash);

    return {block_hash, block_size};
  }

  async _register_manifest(block_hash) {
    let block_path = this.block_path(block_hash);

    //create SLO with all that  \o/
    let manifest = [];
    let headers = {[BIGFILE_HEADER] : block_hash};
    for(let {part_hash, part_size, part_path} of this.parts) {
      manifest.push({
        "path"       : `${this.storage_container}/${part_path}`,
        "size_bytes" : part_size,
        "etag"       : part_hash,
      });
      await Storage.update(this.storage_ctx, this.storage_container, part_path, {headers});
    }

    var etag = md5(manifest.map(line => line.etag).join(''));
    var remote_url = `${block_path}?multipart-manifest=put`;

    await Storage.putStream(this.storage_ctx, bl(JSON.stringify(manifest)), this.storage_container, remote_url, {etag, 'content-type' :  MIME_LARGE});
  }

  async _open() {
    this.block_offset = 0;
    this.block_hash   = crypto.createHash('md5');
    this._new_part();
  }

  _close_part() {
    this.part_fd.end();
    this.part_fd = null;

    let part = {
      part_path : this.part_path,
      part_hash : this.part_hash.digest("hex"),
      part_size : this.part_offset
    }; //console.log("Got part", part);

    this.parts.push(part);
  }

  _new_part() {
    this.part_hash    = crypto.createHash('md5');
    this.part_path    = sprintf("%s/%s", SEGMENT_PREFIX, guid());
    let remote_path = Storage.tempURL(this.storage_ctx, this.storage_container, this.part_path, 'PUT');
    const query = {...url.parse(remote_path), method : 'PUT'};
    this.part_fd      = https.request(query);
    this.part_offset  = 0;
  }

  write(buf, len, offset, cb) {

    if(!this.part_fd) {
      this._open().then(() => {
        this.write(buf, len, offset, cb);
      });
      return;
    }

    if(this.block_offset !== offset)
      return cb(-29); //fuse.ESPIPE

    let remain = len - (BIGFILE_SPLIT - this.part_offset);
    let fixed = remain >= 0 ? BIGFILE_SPLIT - this.part_offset : len;

    //console.log("Writing", {len, offset, fixed, remain});

    this.part_fd.write(buf.slice(0, fixed), () => {
      this.block_hash.update(buf.slice(0, fixed));
      this.part_hash.update(buf.slice(0, fixed));

      this.part_offset  += fixed;
      this.block_offset += fixed;

      if(remain <= 0)
        return cb(fixed);

      this._close_part();
      this._new_part();

      this.write(buf.slice(fixed), remain, this.block_offset, (size1) => {
        //console.log("DONE WRITING", fixed + size1);
        cb(fixed + size1);
      });
    });
  }

}

module.exports = SeqWriteFile;
