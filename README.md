Cloudfs.

// make it work, make is fast, make it clean


[![Build Status](https://travis-ci.org/131/cloudfs.svg?branch=master)](https://travis-ci.org/131/cloudfs)
[![Coverage Status](https://coveralls.io/repos/github/131/cloudfs/badge.svg?branch=master)](https://coveralls.io/github/131/cloudfs?branch=master)
[![Version](https://img.shields.io/npm/v/cloudfs.svg)](https://www.npmjs.com/package/cloudfs)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](http://opensource.org/licenses/MIT)
[![Code style](https://img.shields.io/badge/code%2fstyle-ivs-green.svg)](https://www.npmjs.com/package/eslint-plugin-ivs)

![Available platform](https://img.shields.io/badge/platform-win32-blue.svg)
![Available platform](https://img.shields.io/badge/platform-linux-blue.svg)


# Motivation

Unlimited drive.

cloudfs is a **file system** that stores all its data in the cloud.
cloudfs store file contents in a CAS designed cloud object storage backend [openstack swift](https://developer.openstack.org/api-ref/object-store/) and files metadata (inode table) in an SQL database (sqlite - [see dedicated sqlfs project](https://github.com/131/sqlitefs)).


# Roadmap
- [X] Read Only POC using full openstack creds
- [X] Full Read Only POC using tempUrl keys (no full creds ever required)
- [X] Writable Inodes POC (rename, delete, mkdir)
- [X] Minimal fs driver
- [X] Initial test flow (through fs driver)
- [X] Proper deployment flow
- [X] Writable/editable files (fs mode)

- [ ] Writable/editable big files (fs mode)  <= *current*
- [ ] Writable files (cloud mode)
- [ ] Writable big files (cloud mode)
- [ ] Embbed configuration/web browse server
- [ ] Publish read-only mode
- [ ] With full test suite (e.g. winfsp/secfs test suite)

# Background daemon & pending tasks
- [ ] Garbage collection
- [ ] Support for nwjs (fuse-binding & sqlite3)


# Features
* Simple by design
* Available on all platforms (linux & Windows)
* Fast (sqlite is actually fastest than most file system)
* large subset of POSIX including reading/writing files, directories, rename,  symlinks, mode, uid/gid, and extended attributes
* renames do not invole any kind of server side copy
* native file deduplication - through CAS
* Compatible with existing CAS

## Additional features
* nice configuration GUI
* Directroy tree snapshot / rollback / sealing (pure SQL)
* Instant file deletion (pure SQL)
* Server side TAR creation (so content duplication) - through static large object.


# Related
* [s3ql](https://github.com/s3ql/) python based, non CAS (but fixed block)

# Credits
* [131 - author](https://github.com/131)
