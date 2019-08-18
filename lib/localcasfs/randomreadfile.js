"use strict";

/**
* Read a local file at random offset,
* with large file (swift style manifest) support
*/

const fs = require('fs');
const {fuse, logger} = require('../utils');


class RandomReadFile {

  constructor({block_hash, block_path}) {
    this.block_path = block_path;
    this.block_hash = block_hash; //might be a manifest
    this.manifest = []; // [{etag, size, fd : null}, {etag, size}]
  }

  close() {
    for(let part of this.manifest) {
      if(part.fd)
        part.fd = (fs.closeSync(part.fd), null);
    }
  }

  async _open() {
    logger.debug("Opening", this.file_path);
    let file_path = this.block_path(this.block_hash);
    //here, add manifest file support
    try {
      let fd   = fs.openSync(file_path, 'r'), stat = fs.fstatSync(fd);
      this.manifest = [{etag : this.block_hash, size : stat.size, fd}];
    } catch(err) {
      if(err.code != fuse.ENOENT)
        throw err;
      let manifest_path = `${file_path}.manifest`;
      this.manifest = JSON.parse(fs.readFileSync(manifest_path));
    }
  }

  //read to end of current block, let the OS request more bytes afterwards
  read(buf, len, offset, cb) {

    if(!this.manifest)
      this._open();

    console.log("Reading %d bytes at %d offset", len, offset);

    let part;
    for(part of this.manifest) {
      if(offset <= part.size)
        break;
      offset -= part.size;
    }

    len = Math.min(len, part.size - offset);
    console.log("Fixed to %d bytes at %d offset", len, offset, part);

    if(len <= 0)
      return cb(0);

    if(!part.fd)
      part.fd = fs.openSync(part.etag, 'r');

    fs.read(part.fd, buf, 0, len, offset, function(err, size) {
      cb(size);
    });
  }

}


module.exports = RandomReadFile;
