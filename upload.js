"use strict"; 
 // make it work, make is fast, make it clean

const fs = require('fs');
const tar = require('tar-fs');
const path = require('path');

const bl  = require('bl');

const cp = require('child_process');
const crypto = require('crypto');

const readdir = require('nyks/fs/readdir');
const filesizeSync =  require('nyks/fs/filesizeSync');
const guid = require('mout/random/guid');
const md5 = require('nyks/crypto/md5');
const set = require('mout/object/set');

const promisify = require('nyks/function/promisify');
const md5File   = promisify(require('nyks/fs/md5File'));
const passthru = promisify(require('nyks/child_process/passthru'));
const request  = promisify(require('nyks/http/request'));

const pipe    = require('nyks/stream/pipe');
const drain    = require('nyks/stream/drain');
const rtrim    = require('mout/string/rtrim');
const Storage = require('swift/storage');
const SContext = require('swift/context');
const sprintf = require('util').format;
const ProgressBar = require('progress');
const stripStart = require('nyks/string/stripStart');
const prettyFileSize = require('nyks/string/prettyFileSize');
const startsWith = require('mout/string/startsWith');

const filemtimeSync = require('nyks/fs/filemtimeSync');
const difference = require('mout/array/difference');
const sleep = require('nyks/async/sleep');

const Context = require('./libs/context');
const fuse      = require('fuse-bindings')
const defer     = require('nyks/promise/defer')
const mountPath = process.platform !== 'win32' ? './mnt' : 'M:'
const pluck     = require('mout/array/pluck');

const {S_IFMT, S_IFREG, S_IFDIR, S_IFCHR, S_IFBLK, S_IFIFO, S_IFLNK, S_IFSOCK} = fs.constants;
const {O_RDONLY, O_WRONLY, O_RDWR} = fs.constants;

const EMPTY_MD5 = md5('');
const cache = function(thunk, prop, self, policy, i = 0) {
  cache[prop] = {};

  if(policy)
    set(cache, `policies.${policy}.${prop}`, prop);
  return function(...args) {
    if(cache[prop][args[i]])
      return cache[prop][args[i]];
    cache[prop][args[i]] = thunk.apply(self, args);
    return cache[prop][args[i]];
  }
};

cache.invalidate = function(policy, path) {
  var trail = path != '/' ? `${path}/` : '/';
  for(var prop in cache.policies[policy]) {
    //cache[prop] = {};
    for(var entry of Object.keys(cache[prop])) { //do not loop in cache[prop] as we drop keys
      if(entry == path || startsWith(entry, trail)) {
        console.log("Invaliding cache[%s][%s] because of %s", prop, entry, path);
        delete cache[prop][entry];
      }
    }
  }

}

const nodeify   = function(worker, self) {
  return function(...payload) {
    var chain = payload.pop();
    worker.apply(self, payload).then(function(body) {
      chain(0, body);
    }).catch(function(err) {
      if(!isFinite(err))
        console.error(err);
      chain(err);

    });
  };
};

const POLICY_PATH = "path";

// http://www-numi.fnal.gov/offline_software/srt_public_context/WebDocs/Errors/unix_system_errors.html

const container   = 'repository_files';
const RCLONE_REMOTE = 'remote';

class foo {

  constructor() {
    this._get_entry  = cache(this._get_entry, 'entries', this, POLICY_PATH);
    this._stat_block = cache(this._stat_block, 'blocks', this);
    this.lookup_directory = cache(this.lookup_directory, 'lookup_directory', this, POLICY_PATH, 1);

    this.fd = 10;
    this.files = {};
  }

  async check_remote() {
    let res = await Storage.getFileList(this.ctx.storage, container);
    let blocks = await this.ctx.lnk.select("cloudfs_blocks_list");
      //reindex
    blocks = blocks.reduce( (blocks, block) => (blocks[block.block_hash] = block, blocks), {});
    for(let block_hash in blocks) blocks[block_hash].segments = [];

    let segments = await this.ctx.lnk.select("cloudfs_blocks_segments", true, "*", "ORDER BY part_order");
    for(let {part_order, block_hash, part_hash} of segments)
      blocks[block_hash].segments[part_order] = part_hash;

    //checking all remote content
    for(var block of res)
      await this.check_remote_block(blocks, block);

    console.log("NOW CHECKED");
  }

  async check_remote_block(blocks, block) {
    let {hash : block_hash, bytes : block_size, name : block_path} = block;
    //on manifest, name will contains the full container name
    block_path = stripStart(block_path, `/${container}/`);

    let entry = blocks[block_hash];
    let challenge_path = [block_hash.substr(0,2), block_hash.substr(2,1), block_hash].join('/');


    if(challenge_path != block_path) {
      await this._check_large_block(blocks, block);
    }

    if(!entry) {
      await this.ctx.lnk.insert("cloudfs_blocks_list", {block_hash, block_size});
      return;
    }

    if(entry.block_size != block_size)
      throw `Corrupted remote block_size for ${block_hash} (${block_size})`;
  }

  async _check_large_block(blocks,  {hash : etag_hash, name : block_path}) {
    let block_hash = path.basename(block_path);
    let challenge_path = [block_hash.substr(0,2), block_hash.substr(2,1), block_hash].join('/');
console.log({challenge_path, block_path});
    if(challenge_path != block_path) {
      throw `Non segmented corrupted file`;
    }

      //check as SLO
    var remote_url = `${block_path}?multipart-manifest=get`;
    let manifest = await Storage.download(this.ctx.storage, container, remote_url);
    if(!manifest.headers['x-static-large-object'])
      throw `Remote object is no large object`;

    manifest = JSON.parse(await drain(manifest));

    let entry = blocks[block_hash];
    if(entry && entry.segments.length) {
      var etag_hash      = md5(entry.segments.join(''));
      var etag_challenge = md5(pluck(manifest, 'name').map(a => path.basename(a)).join(''));
      if(etag_hash != etag_challenge)
        throw `Validate block against segments`;
      return;
    }


    console.log("SHOULD CREATE LARGE", block_hash);
    var token = await this.ctx.lnk.begin();
    var etag_challenge = [], block_size = 0;
    //check all manifest parts
    for(let part_order in manifest) {
      let part = manifest[part_order];
      await this.check_remote_block(blocks, part);
      console.log("NOW SHOULD REGISTER AS SEGMENT", {block_hash, part_order, part_hash : part.hash}, part);
      await this.ctx.lnk.insert("cloudfs_blocks_segments", {block_hash, part_order, part_hash : part.hash});
      block_size += part.bytes;
      etag_challenge.push(part.hash);
    }
    etag_challenge = md5(etag_challenge.join(''));
      //etag challenge might be compare to a HEAD request
      //register main segment
    let block  = {block_hash, block_size, block_segmented : true};
    await this.ctx.lnk.insert("cloudfs_blocks_list", block);
    await this.ctx.lnk.commit(token);
  }

  async readdir(directory_path) {
    console.log('readdir(%s)', directory_path)

    try {
      var ctx = this.ctx.fork();

      var parent_uid  = await this.lookup_directory(ctx, directory_path);
      var directory_root = rtrim(directory_path,  "/");  // allow root to be merged

      var entries = await ctx.lnk.select("cloudfs_files_list", [{parent_uid}, "file_uid != parent_uid"]);

      { //feed whatever we might need in cache
        var blocks = difference(pluck(entries, "block_hash").filter(Boolean), Object.keys(cache.blocks));

        if(blocks.length) {
          var blocks = await this.ctx.lnk.select("cloudfs_blocks_list", {block_hash : blocks});
          for(var block of blocks)
            cache.blocks[block.block_hash] = block;
        }

        for(var entry of entries)
          cache.entries[`${directory_root}/${entry.file_name}`] = entry;
      }
      var result = pluck(entries, "file_name");
      return result;
    } finally {
      ctx.close();
    }
  }

  async lookup_directory(ctx, directory_path) {
    console.log("lookup_directory", directory_path);
    var paths = directory_path.split("/");
    if(paths.shift() != "")
      throw `Unsupported relative paths`;

    var parent_uid = ctx.mountpoint.file_uid;
    var file_type  = 'directory';

    for(var file_name of paths) {
      let line = await ctx.lnk.row("cloudfs_files_list", {file_name, parent_uid, file_type});
      if(!line)
        throw `Non existent path ${directory_path}`;
      parent_uid = line.file_uid;
    }

    return parent_uid;
  }

  async _stat_block(block_hash) {
    return this.ctx.lnk.row("cloudfs_blocks_list", {block_hash});
  }

  //return false in an entry does not exists
  async _check_entry(file_path) {
    return this._get_entry(file_path).catch( err => {
      if(err == fuse.ENOENT)
        return false;
      throw err;
    });
  }

  async _get_entry(file_path) {
    console.log("Get entry", file_path);
    var parent_uid = await this.lookup_directory(this.ctx, path.dirname(file_path));
    var file_name  = path.basename(file_path);
    var entry = await this.ctx.lnk.row("cloudfs_files_list", {parent_uid, file_name});
    if(!entry)
      throw fuse.ENOENT;
    return entry;
  }

  async getattr(file_path) {
    console.log("Get getattr", file_path);
    var entry = await this._get_entry(file_path);
    var {file_type} = entry, size, mode;

    if(file_type == 'directory') {
      size = 100;
      mode = (S_IFMT & S_IFDIR) | 0o777;
    }

    if(file_type == 'file') {
      let block = await this._stat_block(entry.block_hash);
      size = block.block_size;
      mode = (S_IFMT & S_IFREG) |0o666;
    }

    var stat = {
      mtime: new Date(entry.file_mtime * 1000),
      ctime: new Date(entry.file_ctime * 1000),
      atime: new Date(),
      nlink: 1,

      //https://github.com/billziss-gh/winfsp/issues/40
      uid: 65792, //WD
      gid: 65792,
      size,
      mode,
    };

    return stat;
  }

  async release(file_path, fd) {
    console.log('release', file_path, fd);
    var ent = this.files[fd];
    if(!ent)
      return;
    var {entry, block_hash, block_size, tmp_uid, rfd} = ent;

    if(typeof ent.rfd != 'function')
      fs.closeSync(rfd);

    delete this.files[fd];

    
    if(block_hash) {
      var file_uid = entry.file_uid;
      block_hash = block_hash.digest('hex');
      console.log("GOT CONTENT HASH", block_hash);
      var from_create = typeof ent.rfd == 'function' && block_hash == EMPTY_MD5;
      do {
        if(from_create)
          break;
        let res = await Storage.getFileList(this.ctx.storage, "repository_files", tmp_uid);
        if(res.length)
          break;
        console.log("Waiting for %s to appear", tmp_uid);
        await sleep(200);
      } while(true);

      let line = await this.ctx.lnk.row("cloudfs_blocks_list", {block_hash});
      if(!from_create) {
        if(!line) {
          //use server side copy to store block to proper location

          let block_path = [block_hash.substr(0,2), block_hash.substr(2,1), block_hash].join('/');
          let args = ['-vv', 'rc', 'operations/movefile', 'srcFs=repository:repository_files', 'dstFs=repository:repository_files',  `srcRemote=${tmp_uid}`, `dstRemote=${block_path}`];
          await passthru('rclone', args);
          console.log("All good");
          await this.ctx.lnk.insert("cloudfs_blocks_list", {block_hash, block_size});
        } else {
          await passthru('rclone', ['-vv', 'rc', 'operations/deletefile', 'fs=repository:repository_files', `remote=${tmp_uid}`]);
        }
        await passthru('rclone', ['rc', 'vfs/forget']);
      }

      await this.ctx.lnk.update("cloudfs_files_list", {block_hash}, {file_uid});
      await this.touch(file_path);
    }

  }

  async open(file_path, flags) {
    console.log('open(%s, %d)', file_path, flags)

    if(flags == O_WRONLY || flags == O_RDWR)
      return this._open_w(file_path, flags);

    if(flags != O_RDONLY) {
      console.log("DISABLE OPEN WITH ", file_path, flags);
      throw fuse.EPERM;
    }

    var entry = await this._get_entry(file_path);
    var block_path = path.join(RCLONE_REMOTE, entry.block_hash.substr(0,2), entry.block_hash.substr(2,1), entry.block_hash);

    var rfd  = function() {
      return fs.openSync(block_path, flags);
    };
    this.fd++;
    this.files[this.fd] = {file_path, flags, entry, rfd};

    return this.fd; // 42 is an fd
  }


  async _open_w(file_path, flags) {

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

  write(path, fd, buf, len, pos, cb) {
    console.log("Write", fd, len, buf.length);
    var ent = this.files[fd];
    if(!ent) {
      console.error("Could not write", path);
      throw cb(0);
    }
    if(typeof ent.rfd == 'function')
      ent.rfd = ent.rfd();
    var rfd = ent.rfd;

    ent.block_hash.update(buf); //slice ?
    ent.block_size += len;
    fs.write(rfd, buf, 0, len, pos, function(err, nb) {
      if(err) {
        console.error(err);
        cb(fuse.EIO);
      }
      cb(nb);
    });
  }

  read(path, fd, buf, len, pos, cb) {
    var ent = this.files[fd];
    if(!ent) {
      console.error("Could not read", path);
      throw cb(0);
    }
    if(typeof ent.rfd == 'function')
      ent.rfd = ent.rfd();
    var rfd = ent.rfd;
    fs.read(rfd, buf, 0, len, pos, function(err, nb) {
      if(err)
        console.error(err);
      cb(nb);
    });
  }
  ftruncate(path, fd, size, cb) {
    console.log("ftruncate", path, fd, size);
    var ent = this.files[fd];
    if(!ent) {
      console.error("Could not write", path);
      throw cb(0);
    }
    if(typeof ent.rfd == 'function')
      ent.rfd = ent.rfd();
    var rfd = ent.rfd;
    fs.ftruncate(rfd, size, function(err){
      if(err)
        console.error(err);
      cb(0);
    });
  }

  async create(file_path, mode) {
    console.log('create(%s, %d)', file_path, mode);
    var entry = await this._check_entry(file_path);
    if(entry)
      throw fuse.EEXIST;


    var parent_path = path.dirname(file_path);
    var {file_uid : parent_uid} = await this._get_entry(parent_path);
    var block_hash  = EMPTY_MD5;
    var file_name   = path.basename(file_path);
    var data  = {
      file_uid   : guid(),
      file_name,
      parent_uid,
      block_hash,
      file_type  : 'file',
    };

    if(await this.ctx.lnk.row("cloudfs_files_list", {parent_uid, file_name}))
      throw fuse.EEXIST;

    await this.ctx.lnk.insert("cloudfs_files_list", data);
    await this.touch(parent_path);

    return this._open_w(file_path);
  }



  async statfs(path) {
    //={Bsize:4096 Frsize:4096 Blocks:274877906944 Bfree:273011914316 Bavail:274877906944 Files:1000000000 Ffree:1000000000 Favail:0 Fsid:0 Flag:0 Namemax:255}

    console.log('statfs(%s)', path)
    var files  = Number(await this.ctx.lnk.value("cloudfs_files_list", true, "COUNT(*)"));
    var total  = Number(await this.ctx.lnk.value("cloudfs_blocks_list", true, "SUM(block_size)"));

    var bsize = 1000000;
    var max   = 1 * Math.pow(2, 10 + 10 + 10 + 10 + 10); //32 PB
    var blocks = Math.floor(max / bsize);
    var bfree  = Math.floor((max - total) / bsize);
    var statfs = {
        namemax: 255,   /* Maximum length of filenames */
        fsid: 1000000,  /* Filesystem ID */
        files,  /* Total file nodes in filesystem */

        bsize,  /* Optimal transfer block size */
        blocks, /* Total data blocks in filesystem */
        bfree,           /* free blocks  */
        bavail : bfree,  /* free available blocks */

        frsize: bsize,   /* Fragment size  */
        ffree: 1000000,  /* free inodes */
        favail: 1000000, /* free available inodes */
        flag: 1000000,   /* Mount flags */
    };

    return statfs;
  }

  async rename(src_path, dest_path) {
    if(src_path == dest_path)
      return;

    var src = await this._get_entry(src_path);
    console.log('rename', src_path, dest_path, src);

    var src_parent = await this._get_entry(path.dirname(src_path));
    var dst_parent = await this._get_entry(path.dirname(dest_path));

    var data = {
      file_name  : path.basename(dest_path),
      parent_uid : dst_parent.file_uid,
    };

    cache.invalidate(POLICY_PATH, path.dirname(src_path));
    cache.invalidate(POLICY_PATH, path.dirname(dest_path));
    cache.invalidate(POLICY_PATH, dest_path);
    await this.ctx.lnk.update("cloudfs_files_list", data, {file_uid : src.file_uid});

    return 0;
  }

  async unlink(file_path) {
    console.log("unlink", file_path);
    
    var entry = await this._get_entry(file_path);
    if(entry.file_type != 'file')
      throw fuse.EISDIR;

    await this.ctx.lnk.delete("cloudfs_files_list", {file_uid : entry.file_uid});
    await this.touch(path.dirname(file_path));
  }

  async rmdir(directory_path) {
    console.log("rmdir", directory_path);
    
    var entry = await this._get_entry(directory_path);
    if(entry.file_type != 'directory')
      throw fuse.ENOTDIR;
    await this.ctx.lnk.delete("cloudfs_files_list", {file_uid : entry.file_uid});

    await this.touch(path.dirname(directory_path));
  }

  async touch(file_path) {
    console.log("touch", file_path);
    var {file_uid} = await this._get_entry(file_path);
    var now = Math.floor(Date.now() / 1000);
    await this.ctx.lnk.update("cloudfs_files_list", {file_mtime : now}, {file_uid});

    cache.invalidate(POLICY_PATH, file_path);
  }

  async mkdir(directory_path, mode) {
    console.log("mkdir", directory_path, mode);
    var entry = await this._check_entry(directory_path);
    if(entry)
      throw entry.file_type == "directory" ? fuse.EEXIST : fuse.ENOTDIR;

    var parent_path = path.dirname(directory_path);
    var parent = await this._get_entry(parent_path);
    var data  = {
      file_uid   : guid(),
      file_name  : path.basename(directory_path),
      parent_uid : parent.file_uid,
      file_type  : 'directory',
    };
    await this.ctx.lnk.insert("cloudfs_files_list", data);

    await this.touch(parent_path);
    return 0;
  }

    //start rclone backend
  async mount_remote() {

    var args = ['-vv', '--rc', '--rc-no-auth', '--swift-no-chunk', 'mount', 'repository:repository_files', RCLONE_REMOTE];

    passthru("rclone", args);
  }

  async mount() {
    await this.mount_remote();

    var next = defer();
    fuse.mount(mountPath, {

      getattr : nodeify(cache(this.getattr, 'getattr', this, POLICY_PATH), this),
      readdir : nodeify(cache(this.readdir, 'readdir', this, POLICY_PATH), this),
      mkdir   : nodeify(this.mkdir, this),
      rmdir   : nodeify(this.rmdir, this),
      rename  : nodeify(this.rename, this),

      read    : this.read.bind(this),
      open    : nodeify(this.open, this),
      write   : this.write.bind(this),
      ftruncate : this.ftruncate.bind(this),

      create  : nodeify(this.create, this),
      unlink  : nodeify(this.unlink, this),
      release : nodeify(this.release, this),

      statfs : nodeify(cache(this.statfs, 'statfs', this, POLICY_PATH), this),


      access : (path, mode, cb) => {console.log('access', arguments); cb(); },

      fgetattr : (path, fd, cb) => { cb(); }, //console.log('fgetattr', path, fd);
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

    console.log('filesystem mounted on ', mountPath)


    process.on('SIGINT', function () {
      fuse.unmount(mountPath, function (err) {
        if (err) {
          console.log('filesystem at ' + mountPath + ' not unmounted', err)
        } else {
          console.log('filesystem at ' + mountPath + ' unmounted')
        }
      })
    })
  }


  async start() {
    var config = require('./config/prod.json');
    this.ctx   =  new Context(config);
    this.ctx.storage = await SContext.build(this.ctx.config('credentials'));
    this.ctx.mountpoint = await this.lookup_mountpoint("/");
    console.log("Lookup mount point", this.ctx.mountpoint);
  }


  async lookup_mountpoint() {
    var file_name = "";
    var file_type = "directory";
    //naive root point
    var line = await this.ctx.lnk.row("cloudfs_files_list", ["file_uid = parent_uid", {file_type}]);

    if(!line) {
      let file_uid = guid();
      line = {file_uid, parent_uid : file_uid, file_name};
      await this.ctx.lnk.insert("cloudfs_files_list", line);
    }
    return line;
  }

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


  async upload_dir(input_dir) {
    var list = readdir(input_dir);
    var manifest = [];

    for(var file_path of list) {
      let block = await this.register_block(file_path);
      manifest.push(block);
    }

    console.log("all done");
    return manifest;
  }


  /**
  * this is furious openstack magic
  * 1st step : we upload all file in a directory
  * 2nd step : we create a pseudo tar using a valid swift static large object
  * see https://docs.openstack.org/swift/latest/api/large_objects.html
  *  [ [file0_metadata_header as b64] , file0_ref, [file1_metadata_header as b64] , file1_ref, ...]
  * Final tar hash is computed on the fly, so tar is also in CAS - boo yeah - 
  */
  async mktar(input_dir) {
    var files_list = await this.upload_dir(input_dir);

    console.log("MKTAR", files_list);
    var entries = {};

    for(var entry of files_list)
      entries[stripStart(path.resolve(entry.file_path), path.resolve(input_dir)).substr(1)] = entry;

    var parts = await this._create_chunked_tar(input_dir);

    var content_hash = crypto.createHash('md5');
    var etag_hash    = [];
    var manifest = [];
      //now compute global md5 and create manifest
    for(var part of parts) {
      let entry;

        //part is a buffer
      if(Buffer.isBuffer(part)) {
        entry = await this.upload_buffer(part);
        content_hash.update(part);
      } else {
        entry = entries[part.file_path];
        if(!entry)
          throw `Un-mapped file ${part.file_path}`;
        let foo = fs.createReadStream(entry.file_path);
        //foo.on('data', dst.write.bind(dst));
        console.log("Computing continius hash on", entry.file_path);
        foo.on('data', content_hash.update.bind(content_hash));
        await new Promise( resolve => { foo.on('close', resolve); });
      }

      etag_hash.push(entry.block_hash);

      manifest.push({
        "path"       : path.join(container, entry.remote_path),
        "size_bytes" : entry.block_size,
        "etag"       : entry.block_hash,
      });
    }

    var manifest_md5 = content_hash.digest('hex');
    var manifest_path = sprintf("%s/%s/%s", manifest_md5.substr(0,2), manifest_md5.substr(2, 1), manifest_md5);
    etag_hash = md5(etag_hash.join(''));
    console.log({manifest, manifest_md5, etag_hash});

    try {
      await Storage.deleteFile(this.ctx, container, manifest_path);
      await Storage.download(this.ctx.storage, container, manifest_path);
      return {manifest_path}; //no need to upload file
    } catch(err) {
    }

    console.log("Should upload as ", manifest_path);

    var remote_url = `${manifest_path}?multipart-manifest=put`;
    var instream = bl(JSON.stringify(manifest));
    await Storage.putStream(this.ctx.storage, instream, container, remote_url,  {etag : etag_hash})

    var res = await Storage.download(this.ctx.storage, container, manifest_path);
    console.log({etag : etag_hash}, res.headers);
  }

  async _create_chunked_tar(input_dir) {
    //construct an intermediate tar archive using tar-fs

    var uid = guid();
    var list = readdir(input_dir);
    var entries = [];
    
    for(var file_path of list)
      entries.push(stripStart(path.resolve(file_path), path.resolve(input_dir)).substr(1));

    var pack = tar.pack(input_dir, {
      entries: entries,
      mapStream: function(fileStream, header) {
        var rs = bl([uid, header.name, "\0"]);
        //make tar-stream happy about size
        rs.on('end', function() {
          rs._readableState.pipes.written = header.size;
        });
        return rs;
      }
    });

    var contents = await drain(pack);

      //now, split intermediate tar parts & headers
    var parts = [];
    for(var i = 0 ; i < contents.length;) {
      let n = contents.indexOf(uid, i), end = contents.indexOf("\0", n);
      if(n == -1)
        break;
      parts.push(contents.slice(i, n));
      var file_path = contents.slice(n + uid.length, end).toString()
      parts.push({file_path});
      i = end + 1;
    }
    parts.push(contents.slice(i, contents.length));
    return parts;
  }


  async upload_buffer(body) {
    let block_hash = md5(body), block_size = body.length;

    var remote_path = sprintf("%s/%s/%s", block_hash.substr(0,2), block_hash.substr(2, 1), block_hash);


    try {
      await Storage.download(this.ctx.storage, container, remote_path);
      return {block_size, block_hash, remote_path}; //no need to upload block
    } catch(err) {  }
    console.log("Now uploading to %s", remote_path);
    var bar = new ProgressBar("[:bar] :percent :etas", {total:  block_size, width : 60, incomplete : ' ', clear : true});
    instream.on('data', buf => bar.tick(buf.length));

    await Storage.putStream(this.ctx.storage, bl(body), container, remote_path, {etag : block_hash});
    return {block_size, block_hash, remote_path};
  }




}


module.exports = foo;
