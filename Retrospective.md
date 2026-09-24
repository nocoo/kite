# Retrospective

## 2026-09-25: Version and fixture assumptions during Pi research

The upstream checkout and installed CLI both declared version 0.87.1, so an early research update treated `provider_stream_event` as available locally. A loopback-provider probe disproved this: the event exists only in upstream `main` after the release. The changelog lists it under Unreleased and release tag `v0.87.1` predates its merge. Future capability inventories must compare release tags, installed declarations, and runtime behavior; a development branch's package version does not establish released availability.

The first invalid-argument fixture used a number for a string field. Pi coerced it and executed the inert tool. The fixture now omits the required field, which reliably exercises validation failure. Use demonstrably invalid inputs when testing validation paths rather than assuming a schema mismatch cannot be coerced.
