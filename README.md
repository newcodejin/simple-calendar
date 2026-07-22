# Simple Calendar

A minimal calendar you can lightly decorate.

## Options

- **Mark days with a daily note** — turn the daily note marker on or off.
- **Days outside this month** — choose how to display days that belong to the previous or next month: Dim, Show normally, or Hide.
- **Marker style** — a small dot, or any character/emoji you like (e.g. ✓ ★ 🔥).
- **Use theme color for marker** — when on, the marker follows your theme's accent color; turn it off to pick a custom color.
- **Marker size** — marker size (3–9px).

Changes apply to any open calendar immediately.

## Notes

- The date format, folder, and template follow the core "Daily notes" plugin settings (or Periodic Notes if the core plugin is disabled). This plugin has no settings of its own for those.
- Daily notes are recognized by filename. Only files whose name contains a readable year, month, and day are treated as daily notes, so notes without a date never get a marker.
- The weekday and time parts of a filename do not affect recognition. Whether the weekday was saved as (화) or (Tue), and whatever the time is, the file is recognized as long as the date matches. Adding or removing time/weekday parts from your format also keeps existing files recognized.
- However, changing the order of the date itself (e.g. YYYY-MM-DD → DD-MM-YYYY) can make files in the old format resolve to the wrong day.
- If your format uses month names (MMM, e.g. "Jul 15, 2026"), files created before switching Obsidian's language will no longer be recognized.

## License

MIT
