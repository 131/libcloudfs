"use strict";

/**
* Write a local file sequentialy (at non random offset)
* with large file (swift style manifest) support
*/
const fs     = require('fs');
const crypto = require('crypto');
const path   = require('crypto');

const guid    = require('mout/random/guid');
const mkdirpSync = require('nyks/fs/mkdirpSync');
const {fuse, logger} = require('../utils');


//const BIGFILE_SPLIT = (1 << 30) * 5; //5Go
const BIGFILE_SPLIT = (1 << 20) * 5; //5Mo


class SeqWriteFile {
  constructor({block_size_limit, block_end, block_path, block_tmp}) {

    this.block_size_limit = block_size_limit || BIGFILE_SPLIT;
    this.block_end        = block_end;
    this.block_path       = block_path;
    this.block_tmp        = block_tmp;

    this.block_offset = 0;
    this.parts = [];
  }

  async close() {
    if(!this.part_fd)
      return;

    this._close_part();

    let block_hash = this.block_hash.digest("hex");
    let block_path = this.ctl.block_path(block_hash);
    logger.debug("Got content hash", block_hash, block_path, this.parts);

    let block_size = this.parts.reduce((acc, part) => (acc += part.part_size, acc));
    if(this.parts.length > 1)
      await this._register_manifest();

    await this.block_end(block_hash, block_size);
  }

  _register_manifest() {
    let manifest = [];
    for(let {part_hash, part_size} of this.parts)
      manifest.push({etag : part_hash, bytes : part_size});

    let manifest_path = `${this.block_path}.manifest`;
    mkdirpSync(path.dirname(manifest_path));
    fs.writeFileSync(manifest_path, JSON.stringify(manifest, null, 2));
  }

  async _open() {
    this.block_offset = 0;
    this.block_hash = crypto.createHash('md5');
    this._new_part();
  }

  _close_part() {
    fs.closeSync(this.part_fd);

    let part_hash = this.part_hash.digest("hex");
    let part_path = this.ctl.block_path(part_hash);
    logger.debug("Got part hash", part_hash, part_path);
    mkdirpSync(path.dirname(part_path));
    fs.renameSync(this.part_path, part_path);
    this.part_fd = null;
    this.parts.push({part_hash, part_size : this.part_offset});
  }

  _new_part() {
    this.part_hash    = crypto.createHash('md5');
    this.part_path    = path.join(this.block_root, guid());
    this.part_fd  = fs.openSync(this.target, "w");
    this.part_offset  = 0;
  }

  _rotate_part() {
    this._close_part();
    this._new_part();
  }

  write(buf, len, pos, cb) {
    if(this.block_offset != pos)
      return cb(fuse.ESPIPE); //invalid offset

    if(!this.part_fd) {
      this._open().then(() => {
        this.write(buf, len, pos, cb);
      });
      return;
    }

    if(this.part_offset + len >= this.block_size_limit) {
      console.log("SHOULD CUT TO BIG");
      process.exit();
      let cut_len = this.block_size_limit - this.block_offset;
      let remain = len - cut_len;
      this.write(buf, cut_len, this.block_offset, (size0) => {
        this._rotate_part();
        if(!remain)
          return cb(size0);

        this.write(buf.slice(cut_len), remain, this.block_offset, (size1) => {
          cb(size0 + size1);
        });
      });
    }

    this.content_hash.update(buf.slice(0, len));
    this.part_hash.update(buf.slice(0, len));

    fs.write(this.part_fd, buf, 0, len, pos, (err, size) => {
      this.part_offset  += size;
      this.block_offset += size;
      cb(size);
    });
  }

}

module.exports = SeqWriteFile;
