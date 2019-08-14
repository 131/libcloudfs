"use strict";

const fs = require('fs');

const fuse      = require('fuse-bindings');
const defer     = require('nyks/promise/defer');
const sleep     = require('nyks/async/sleep');
const timeout  = require('nyks/async/timeout');
const mkdirpSync = require('nyks/fs/mkdirpSync');

//const {S_IFMT, S_IFREG} = fs.constants;//, S_IFDIR, S_IFCHR, S_IFBLK, S_IFIFO, S_IFLNK, S_IFSOCK

const {nodeify, isDirectory, logger} = require('./utils');
const {O_WRONLY, O_RDWR} = fs.constants; //O_RDONLY,

class casfs {

  constructor(inodes) {
    this.fd     = 10;
    this.files  = {};
    this.inodes = inodes;
  }

  async release(file_path, fd) {
    logger.debug('release', file_path, fd);
    var ent = this.files[fd];
    delete this.files[fd];

    if(!ent)
      return;

    await ent.close();
  }

  _cas_open(/*block_path*/) {
    throw `To be implemented`;
  }

  async open(file_path, flags) {
    logger.debug('open(%s, %d)', file_path, flags);

    if(flags & O_RDWR) {
      logger.error("O_RDWR disabled for now", file_path, flags);
      throw fuse.ENOSYS; //not implemented
    }

    if(flags & O_WRONLY)
      return this._open_w(file_path, flags);

    var entry = await this.inodes._get_entry(file_path);

    this.fd++;
    this.files[this.fd] = this._cas_open(entry.block_hash);

    return this.fd; // 42 is an fd
  }


  read(path, fd, buf, len, pos, cb) {
    var ent = this.files[fd];
    if(!ent) {
      logger.error("Could not read from", path);
      throw cb(0);
    }

    ent.read(buf, len, pos, cb);
  }

  write(path, fd, buf, len, pos, cb) {
    var ent = this.files[fd];
    if(!ent) {
      logger.error("Could not write to", path);
      throw cb(0);
    }

    ent.write(buf, len, pos, cb);
  }

  async create(file_path, mode) {
    logger.debug('create(%s, %s)', file_path, mode);
    await this.inodes.create(file_path, mode);
    return this._open_w(file_path);
  }

  async _open_w(file_path) {
    var entry = await this.inodes._get_entry(file_path);
    this.fd++;
    this.files[this.fd] = this._cas_write(entry);
    return this.fd;
  }


  async mount(mountPath) {

    if(process.platform != 'win32')
      await mkdirpSync(mountPath);

    this.mountPath = mountPath;
    var next = defer();
    fuse.mount(this.mountPath, {
      //force   : true, //not awailable for win32
      options : ['allow_other'], //for smbd

      getattr : nodeify(this.inodes.getattr, this.inodes),
      readdir : nodeify(this.inodes.readdir, this.inodes),
      mkdir   : nodeify(this.inodes.mkdir, this.inodes),
      rmdir   : nodeify(this.inodes.rmdir, this.inodes),
      rename  : nodeify(this.inodes.rename, this.inodes),
      unlink  : nodeify(this.inodes.unlink, this.inodes),
      utimens : nodeify(this.inodes.utimens, this.inodes),
      statfs : nodeify(this.inodes.statfs, this.inodes),

      read    : this.read.bind(this),
      open    : nodeify(this.open, this),
      create  : nodeify(this.create, this),
      release : nodeify(this.release, this),
      write   : this.write.bind(this),
      truncate : function(path, size, cb) {
        logger.debug("truncate %s to %d", path, size);
        cb();
      },

      ftruncate : function(path, fd, size, cb) {
        logger.debug("ftruncate %s (in %d) to %d", path, fd, size);
        cb();
      },



      access : (path, mode, cb) => {logger.debug('access', arguments); cb(); },
      //fgetattr : (path, fd, cb) => { logger.debug('fgetattr', path, fd); cb(); }, //
      flush  : (path, fd, cb) => { cb(); }, //logger.debug('flush', arguments);

      fsync : (path, fd, datasync, cb) => {logger.debug('fsync', arguments); cb(); },
      fsyncdir : (path, fd, datasync, cb) => {logger.debug('fsyncdir', arguments); cb(); },

      readlink : (path, cb) => {logger.debug('readlink', arguments); cb(); },
      chown : (path, uid, gid, cb) => {logger.debug('chown', arguments); cb(); },
      mknod : (path, mode, dev, cb) => {logger.debug('mknod', arguments); cb(); },

      setxattr : (path, name, buffer, length, offset, flags, cb) => {logger.debug('setxattr', arguments); cb(); },
      getxattr : (path, name, buffer, length, offset, cb) => {logger.debug('getxattr', arguments); cb(); },
      listxattr : (path, buffer, length, cb) => {logger.debug('listxattr', arguments); cb(); },
      removexattr : (path, name, cb) => {logger.debug('removexattr', arguments); cb(); },

      // no need to implement opendir, and it's behave weirldy
      // opendir : (path, flags, cb) => { cb(); }, //logger.debug('opendir', arguments);
      // releasedir : (path, fd, cb) => {cb(); }, //logger.debug('releasedir', arguments);

      link : (src, dest, cb) => {logger.debug('link', arguments); cb(); },
      symlink : (src, dest, cb) => {logger.debug('symlink', arguments); cb(); },
      destroy : (cb) => {logger.debug('destroy', arguments); cb(); },

    }, next.chain);

    logger.info('mounting filesystem at', this.mountPath);
    await next;

    process.on('SIGINT', () => {
      this.close();
      setTimeout(() => process.exit(), 2000);
    });

    let stop  = timeout(5 * 1000, `Cannot find mountpoint ${mountPath}`);

    while(!await Promise.race([sleep(200), isDirectory(mountPath), stop]))
      await Promise.race([sleep(200), stop]);

    logger.info('mounted filesystem on', this.mountPath);
  }


  close() {
    logger.info("SHOULD SUTDOWN", this.mountPath);
    if(!this.mountPath)
      return;

    return new Promise((resolve, reject) => {
      fuse.unmount(this.mountPath, (err) => {
        logger.info('filesystem at', this.mountPath, ...(err ? ['not unmounted', err] : ['unmounted']));
        if(err)
          return reject(err);
        resolve();
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
    logger.info("Working with", file_path, "(now computing file hash)", prettyFileSize(block_size));
    var block_hash = await md5File(file_path);
    var remote_path = sprintf("%s/%s/%s", block_hash.substr(0,2), block_hash.substr(2, 1), block_hash);

    var line = await this.ctx.lnk.row("cloudfs_blocks_list", {block_hash});
    if(line)
      return {...line, remote_path, file_path}; //make sure block is non segmented ?

    //check if file exists remotly
    try {
      await Storage.download(this.ctx.storage, container, remote_path);
    } catch(err) {
      logger.info("Now uploading %s as %s", file_path, remote_path);
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


module.exports = casfs;
