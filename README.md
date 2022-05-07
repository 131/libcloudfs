libcloudfs.

# Motivation
// make it work, make it simple, make is fast, make it clean

Unlimited drive.

[libcloudfs](https://github.com/131/libcloudfs) is [cloudfs](https://github.com/131/cloudfs) main storage driver. 
[libcloudfs](https://github.com/131/libcloudfs) is  a **file system** that stores all its data in the cloud. it stores file contents in a [CAS designed](https://github.com/131/casfs) cloud object storage backend [openstack swift](https://developer.openstack.org/api-ref/object-store/) and files metadata (inode table) in an [SQLlite database](https://github.com/131/sqlfs).


[![Build Status](https://travis-ci.org/131/libcloudfs.svg?branch=master)](https://travis-ci.org/131/libcloudfs)
[![Coverage Status](https://coveralls.io/repos/github/131/libcloudfs/badge.svg?branch=master)](https://coveralls.io/github/131/libcloudfs?branch=master)
[![Version](https://img.shields.io/npm/v/libcloudfs.svg)](https://www.npmjs.com/package/libcloudfs)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](http://opensource.org/licenses/MIT)
[![Code style](https://img.shields.io/badge/code%2fstyle-ivs-green.svg)](https://www.npmjs.com/package/eslint-plugin-ivs)

![Available platform](https://img.shields.io/badge/platform-win32-blue.svg)
![Available platform](https://img.shields.io/badge/platform-linux-blue.svg)

# Installation
libcloudfs is a storage driver, mostly, please refer to the [cloudfs](https://github.com/131/cloudfs) project for installation instructions.


# Project structure
* The [libcloudfs](https://github.com/131/libcloudfs) main driver
* An isolated inode management API (see [sqlfs](https://github.com/131/sqlfs))
* A [fuse bindings](https://github.com/mafintosh/fuse-bindings) interface
* A battle tested [casfs](https://github.com/131/casfs) backend, to challenge implementation, confirm design and stress
* An openstack/[swift](https://github.com/131/swift) driver


# Roadmap
- [X] Read Only POC using full openstack creds
- [X] Full Read Only POC using tempUrl keys (no full creds ever required)
- [X] Writable Inodes POC (rename, delete, mkdir)
- [X] Minimal fs driver
- [X] Initial test flow (through fs driver)
- [X] Proper deployment flow
- [X] Writable/editable files (fs mode)
- [X] a bit better test suite (win/linux)
- [X] (create dedicated project for writable big fs chunks) - see [casfs - dedicated project](https://github.com/131/casfs)
- [X] Testable SeqWriteHTTP module
- [X] Integrated writable files (with bigfile support)
- [X] Publish read-only mode
- [X] Temp write file consolidation


## Upcoming roadmap
- [ ] garbage collector


# Features
* Simple by design
* Available on all platforms (linux & Windows)
* Unlimited file size (cloudfs is mostly designed to store and manage 100k files of 10GB+ - aka HD BR rips)
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
* [casfs](https://github.com/131/casfs/) main backend
* [sqlfs](https://github.com/131/sqlfs/) inode backend
* [s3ql](https://github.com/s3ql/) python based, non CAS (but fixed block)

# Credits/thanks
* [131 - author](https://github.com/131)
* [fuse bindings](https://github.com/mafintosh/fuse-bindings)
