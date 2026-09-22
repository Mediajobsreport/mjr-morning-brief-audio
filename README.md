# MJR Morning Brief Audio

A separate, zero-cost workflow for building the audio edition of the Media Jobs Report Morning Brief.

## Goal

Only stories intentionally selected for audio are included. The newsletter RSS feed is not used or modified.

## Planned workflow

1. Create the full MJR story.
2. Create a 15–20 second broadcast version.
3. Paste the broadcast version into the private Morning Brief manager.
4. The manager timestamps and stores the story.
5. Reorder, edit, or delete stories as needed.
6. Preview total estimated running time.
7. Publish the Morning Brief.
8. The public RSS feed updates with the finished broadcast-ready copy.

## Files

- `data/stories.json` — story data
- `feed.xml` — public RSS output

The private editor will be connected through a secure write endpoint. No GitHub credential will be stored in browser code.
