# About seqwritehttp

SeqWriteHTTP is the dedicated module that power cloudfs capability to create & store new content. All files metadata update (create/touch/unlink) are handled by sqlfsn yet, pushing immutable content to a openstack swift designed cas is no easy task.

# Motivation

I want to write new file in cloudfs as seamlessly as possible. The CAS designed backend storage brings some challenge (having object addressed by their hash content, when the content is yet unkown). Thankfully, swift SLO can help a lot.


* Allow streaming file write (no hash pre-computation)
* Allow big file upload
* Never wait for a server side blocking operation (i.e. using server side copy at the end of a file transfer)
* Never be in an inconsitant state (regardless of any background operation)


# Main design
```
.tmp (with x bigfile header) => full manifest
  THEN (using CAS Consolidation Daemon)
.tmp                         => server side copy  => recreate manifest
```

All write operation are made, from the very first written byte, to a .tmp/[random guid] segments in the targeted swift container. If the segment reach a MAX_SIZE_LIMIT (e.g. 5GB), the content will flow to a new segment. During file write, each segment hash and the whole file hash are computed continously.


When the incoming stream end (i.e. when the file is done writting)
* Each segment are tagged with a x-object-meta-bigfile: [full hash] header
* A SLO manifest is created in the CAS to the final full hash. This SLO manifest can point to one or more .tmp segments.

From now on, a background "consolidating" daemon will trigger.
The ccd (cas consolidation daemon) will move all .tmp segment to their cas location. Each time a segment is moved, the SLO designated in the x-object-meta-bigfile header is updated.

Periodicaly, all .tmp segment not tagged with a x-object-meta-bigfile are cleaned up, as they mosly count for interrupted file transfert.



# Symlink toughts
As for today (2019-09-11), swift symlinks middleware is not yet available by my Openstack provider (OVH). Maybe, using symlink for each BIGFILE (>5GB) .tmp segments could allow me NOT to re-create/update the final SLO manifest after CCD moved a part.

