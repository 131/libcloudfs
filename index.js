"use strict";

// make it work, make is fast, make it clean

const fs = require('fs');


const Storage = require('swift/storage');
const sprintf = require('util').format;

const fuse      = require('fuse-bindings');
const defer     = require('nyks/promise/defer');

const {S_IFMT, S_IFREG} = fs.constants;//, S_IFDIR, S_IFCHR, S_IFBLK, S_IFIFO, S_IFLNK, S_IFSOCK
const {O_RDONLY, O_WRONLY, O_RDWR} = fs.constants;

const RandomReadHTTP = require('random-read-http');

const nodeify   = function(worker, self) {
  return function(...payload) {
    var chain = payload.pop();
    worker.apply(self, payload).then(function(body) {
      chain(0, body);
    }).catch(function(err) {
      if(!isFinite(err))
        console.error(err);
      console.log("Responging with error", err);
      chain(err);
    });
  };
};


class cloudfs {

  constructor(inodes, dst_ctx, dst_container) {
    this.fd     = 10;
    this.files  = {};
    this.inodes        = inodes;
    this.dst_ctx       = dst_ctx;
    this.dst_container = dst_container;
  }

  async release(file_path, fd) {
    console.log('release', file_path, fd);
    var ent = this.files[fd];
    if(!ent)
      return;

    ent.close();
    delete this.files[fd];
  }

  async _open_w(file_path, flags) {
    throw `Not ready for now`;

    var entry = await this._get_entry(file_path);

    //temp block_path
    var tmp_uid = guid();
    var block_path = path.join(RCLONE_REMOTE, tmp_uid);
    var rfd  = function() {
      return fs.openSync(block_path, "w+");
    };

    var block_hash = crypto.createHash('md5'), block_size = 0;
    this.fd++;
    this.files[this.fd] = {file_path, entry, block_hash, block_size, tmp_uid, rfd};
    console.log("OPNEDED IN", this.fd, rfd, block_path);
    return this.fd;
  }

  async open(file_path, flags) {
    console.log('open(%s, %d)', file_path, flags);

    if(flags == O_WRONLY || flags == O_RDWR)
      return this._open_w(file_path, flags);

    if(!flags)
      flags = S_IFREG;

    if((S_IFMT & flags) != S_IFREG) {
      console.log("DISABLE OPEN non regular file", file_path, flags);
      throw fuse.EPERM;
    }
    flags &= ~S_IFMT; //strip format

    if(flags != O_RDONLY) {
      console.log("DISABLE OPEN WITH ", file_path, flags);
      throw fuse.EPERM;
    }

    var entry = await this.inodes._get_entry(file_path);

    var block_path = sprintf("%s/%s/%s", entry.block_hash.substr(0, 2), entry.block_hash.substr(2, 1), entry.block_hash);
    var remoteUrl  = Storage.tempURL(this.dst_ctx, this.dst_container, block_path);

    this.fd++;

    this.files[this.fd] = new RandomReadHTTP(remoteUrl, {
      MAX_BL_SIZE : 100 * 1024 * 1024,
      MIN_BL_SIZE : 20 * 1024 * 1024,
    });

    return this.fd; // 42 is an fd
  }



  read(path, fd, buf, len, pos, cb) {
    var ent = this.files[fd];
    if(!ent) {
      console.error("Could not read", path);
      throw cb(0);
    }

    ent.read(buf, len, pos, cb);
  }

  async create(file_path, mode) {
    await this.inodes.create(file_path, mode);
    return this._open_w(file_path);
  }


  async mount(mountPath) {

    var next = defer();
    fuse.mount(mountPath, {
      options : ['allow_other'], //for smbd

      getattr : nodeify(this.inodes.getattr, this.inodes),
      readdir : nodeify(this.inodes.readdir, this.inodes),
      mkdir   : nodeify(this.inodes.mkdir, this.inodes),
      rmdir   : nodeify(this.inodes.rmdir, this.inodes),
      rename  : nodeify(this.inodes.rename, this.inodes),
      unlink  : nodeify(this.inodes.unlink, this.inodes),
      statfs : nodeify(this.inodes.statfs, this.inodes),

      read    : this.read.bind(this),
      open    : nodeify(this.open, this),
      create  : nodeify(this.create, this),
      release : nodeify(this.release, this),
      //write   : this.write.bind(this),
      //ftruncate : this.ftruncate.bind(this),



      access : (path, mode, cb) => {console.log('access', arguments); cb(); },
      //fgetattr : (path, fd, cb) => { console.log('fgetattr', path, fd); cb(); }, //
      flush  : (path, fd, cb) => {console.log('flush', arguments); cb(); },

      fsync : (path, fd, datasync, cb) => {console.log('fsync', arguments); cb(); },
      fsyncdir : (path, fd, datasync, cb) => {console.log('fsyncdir', arguments); cb(); },

      readlink : (path, cb) => {console.log('readlink', arguments); cb(); },
      chown : (path, uid, gid, cb) => {console.log('chown', arguments); cb(); },
      mknod : (path, mode, dev, cb) => {console.log('mknod', arguments); cb(); },

      setxattr : (path, name, buffer, length, offset, flags, cb) => {console.log('setxattr', arguments); cb(); },
      getxattr : (path, name, buffer, length, offset, cb) => {console.log('getxattr', arguments); cb(); },
      listxattr : (path, buffer, length, cb) => {console.log('listxattr', arguments); cb(); },
      removexattr : (path, name, cb) => {console.log('removexattr', arguments); cb(); },

      // no need to implement opendir, and it's behave weirldy
      // opendir : (path, flags, cb) => { cb(); }, //console.log('opendir', arguments);
      // releasedir : (path, fd, cb) => {cb(); }, //console.log('releasedir', arguments);

      utimens : (path, atime, mtime, cb) => {console.log('utimens', arguments); cb(); },
      link : (src, dest, cb) => {console.log('link', arguments); cb(); },
      symlink : (src, dest, cb) => {console.log('symlink', arguments); cb(); },
      destroy : (cb) => {console.log('destroy', arguments); cb(); },

    }, next.chain);

    await next;

    console.log('filesystem mounted on ', mountPath);

    process.on('SIGINT', function () {
      fuse.unmount(mountPath, function (err) {
        console.log('filesystem at', mountPath, ...(err ? ['not unmounted', err] : ['unmounted']));
        setTimeout(() => process.exit(), 2000);
      });
    });
  }

  /*
  //block should already have been registered
  async register_file(file_path, block_hash) {
    let stat  = fs.statSync(file_path);
    let file_mtime = Math.floor(stat.mtime.getTime() / 1000);
    let file_ctime = Math.floor(stat.ctime.getTime() / 1000);

    //1st, we need to lookup/register the directory
    var directory_path = path.dirname(file_path);
    var file_name      = path.basename(file_path);
    var parent_uid     = await this.register_directory(directory_path);
    var file_type      = 'file';

    //now we lookup for an existing file
    var line = await this.ctx.lnk.row("cloudfs_files_list", {parent_uid, file_name, file_type});
    if(line) {
      if(line.block_hash != block_hash)
        throw `No update for now ${file_path}`;
      return line;
    }

    var file_uid = guid();
    line = {file_uid, file_name, parent_uid, file_mtime, file_ctime, block_hash, file_type};
    await this.ctx.lnk.insert("cloudfs_files_list", line);
    return line;
  }


  async register_block(file_path) {
    var block_size = filesizeSync(file_path);
    console.log("Working with", file_path, "(now computing file hash)", prettyFileSize(block_size));
    var block_hash = await md5File(file_path);
    var remote_path = sprintf("%s/%s/%s", block_hash.substr(0,2), block_hash.substr(2, 1), block_hash);

    var line = await this.ctx.lnk.row("cloudfs_blocks_list", {block_hash});
    if(line)
      return {...line, remote_path, file_path}; //make sure block is non segmented ?

    //check if file exists remotly
    try {
      await Storage.download(this.ctx.storage, container, remote_path);
    } catch(err) {
      console.log("Now uploading %s as %s", file_path, remote_path);
      var instream = fs.createReadStream(file_path);

      var bar = new ProgressBar("[:bar] :percent :etas", {total:  block_size, width : 60, incomplete : ' ', clear : true});
      instream.on('data', buf => bar.tick(buf.length));

      await Storage.putStream(this.ctx.storage, instream, container, remote_path, {etag : block_hash});
    }

    await this.ctx.lnk.insert("cloudfs_blocks_list", {block_hash, block_size});
    return {block_hash, block_size, remote_path, file_path};
  }
*/

}


module.exports = cloudfs;
