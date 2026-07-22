/*
 * Simple Calendar
 * A calendar that marks days on which a daily note exists.
 * Date format and folder follow the core "Daily notes" plugin settings.
 */
const {
  Plugin,
  ItemView,
  TFile,
  moment,
  normalizePath,
  PluginSettingTab,
  Setting,
} = require("obsidian");

const VIEW_TYPE = "simple-calendar-view";
const DAY_KEY = "YYYY-MM-DD"; // canonical per-day map key / compare format

const DEFAULT_SETTINGS = {
  showDots: true, // mark days that have a daily note
  marker: "dot", // marker shape: "dot" or "symbol"
  symbol: "✓", // character used when marker is "symbol"
  outsideDays: "dim", // days outside this month: "dim" / "show" / "hide"
  useThemeDotColor: true, // marker follows the theme accent color
  dotColor: "#8a5cf5", // custom marker color
  dotSize: 5, // marker size in px
};

// Read the daily note settings (format/folder/template).
// Tries the core "Daily notes" plugin first, then the Periodic Notes
// community plugin. Falls back to YYYY-MM-DD in the vault root.
function getDailyNoteSettings(app) {
  const fallback = { format: "YYYY-MM-DD", folder: "", template: "" };
  const build = (opts) => ({
    format: opts.format || fallback.format,
    folder: (opts.folder || "").trim().replace(/\/+$/, ""),
    template: (opts.template || "").trim(),
  });
  try {
    const daily = app.internalPlugins.getPluginById("daily-notes");
    if (daily && daily.enabled && daily.instance) {
      return build(daily.instance.options || {});
    }
    const periodic =
      app.plugins &&
      app.plugins.getPlugin &&
      app.plugins.getPlugin("periodic-notes");
    const pDaily =
      periodic && periodic.settings && periodic.settings.daily;
    if (pDaily && pDaily.enabled) {
      return build(pDaily);
    }
  } catch (e) {
    /* fall through to defaults if settings can't be read */
  }
  return fallback;
}

// Remove weekday tokens (dddd/ddd/dd/d/do) from a moment format.
// Text inside [brackets] is literal, not tokens, so it is left alone.
function stripWeekdayTokens(format) {
  return format.replace(/(\[[^\]]*\])|do|d{1,4}/g, (match, literal) =>
    literal ? literal : ""
  );
}

// Group the files in the daily note folder by day.
// Filenames are parsed with the format instead of compared literally,
// so a file counts for a day as long as its date matches — regardless
// of the weekday language or the time part in the name.
function getNotesByDay(app) {
  const { format, folder } = getDailyNoteSettings(app);
  const prefix = folder ? normalizePath(folder) + "/" : "";
  const map = new Map(); // DAY_KEY string -> TFile

  // Weekday names change with the locale, so drop weekday tokens from
  // parsing entirely; the date is determined by year/month/day tokens.
  const dateFormat = stripWeekdayTokens(format);

  // Literal text in the format must actually appear in the filename
  // (e.g. with "[Daily] YYYY-MM-DD", "Weekly 2026-07-13" is rejected).
  const literals = [...format.matchAll(/\[([^\]]*)\]/g)]
    .map((m) => m[1])
    .filter(Boolean);

  for (const f of app.vault.getMarkdownFiles()) {
    if (prefix && !f.path.startsWith(prefix)) continue;
    const rel = f.path.slice(prefix.length, -3); // strip trailing ".md"
    // If the format has no subfolders but the file is in one, skip it.
    if (!format.includes("/") && rel.includes("/")) continue;
    if (literals.some((lit) => !rel.includes(lit))) continue;

    const parsed = moment(rel, dateFormat); // lenient parsing
    if (!parsed.isValid()) continue;
    // Require year, month, and day to be actually read from the name,
    // so a file like "2026 plans" isn't mistaken for January 1st.
    const unused = parsed.parsingFlags().unusedTokens || [];
    if (unused.some((t) => /[YMD]/.test(t))) continue;

    const key = parsed.format(DAY_KEY);
    if (!map.has(key)) map.set(key, f);
  }
  return map;
}

class SimpleCalendarView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.displayed = moment(); // the month currently shown
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "Simple Calendar";
  }

  getIcon() {
    return "calendar-days";
  }

  async onOpen() {
    // Redraw the markers whenever notes are created, deleted, or renamed.
    for (const ev of ["create", "delete", "rename"]) {
      this.registerEvent(this.app.vault.on(ev, () => this.render()));
    }

    // Move the "today" highlight when the date rolls over at midnight.
    this.todayKey = moment().format(DAY_KEY);
    this.registerInterval(
      window.setInterval(() => {
        const now = moment().format(DAY_KEY);
        if (now !== this.todayKey) {
          this.todayKey = now;
          this.render();
        }
      }, 60 * 1000)
    );

    this.render();
  }

  render() {
    const container = this.contentEl;
    container.empty();
    container.addClass("simple-calendar");

    // Padding lives on our own wrapper, not on Obsidian's contentEl,
    // so themes that restyle the view container can't remove it.
    const el = container.createDiv({ cls: "sc-root" });
    this.applyAppearance(el);
    this.renderHeader(el);

    // Notes grouped by day for this render (click handlers use it too).
    this.notesByDay = getNotesByDay(this.app);

    // Date range: every week the displayed month touches.
    const start = this.displayed.clone().startOf("month").startOf("week");
    const end = this.displayed.clone().endOf("month").endOf("week");
    this.renderWeekdays(el, start);
    this.renderGrid(el, start, end);
  }

  applyAppearance(el) {
    const s = this.plugin.settings;
    el.toggleClass("sc-no-dim", s.outsideDays === "show");
    el.toggleClass("sc-hide-outside", s.outsideDays === "hide");
    el.style.setProperty("--sc-dot-size", s.dotSize + "px");
    el.style.setProperty(
      "--sc-dot-color",
      s.useThemeDotColor ? "var(--interactive-accent)" : s.dotColor
    );
  }

  // Header: month/year + navigation buttons.
  renderHeader(el) {
    const header = el.createDiv({ cls: "sc-header" });
    const title = header.createDiv({ cls: "sc-title" });
    title.createSpan({ cls: "sc-month", text: this.displayed.format("MMMM") });
    title.createSpan({ cls: "sc-year", text: this.displayed.format("YYYY") });

    const nav = header.createDiv({ cls: "sc-nav" });
    const btn = (text, label, cls, onClick) => {
      const b = nav.createEl("button", { cls: "sc-nav-btn " + cls, text });
      b.setAttribute("aria-label", label);
      b.addEventListener("click", onClick);
    };
    btn("‹", "Previous month", "sc-prev", () => {
      this.displayed = this.displayed.clone().subtract(1, "month");
      this.render();
    });
    btn("Today", "Go to today", "sc-today-btn", () => {
      this.displayed = moment();
      this.render();
    });
    btn("›", "Next month", "sc-next", () => {
      this.displayed = this.displayed.clone().add(1, "month");
      this.render();
    });
  }

  // Weekday header: use the names of the first week's seven days,
  // so the locale (and its first day of week) is applied automatically.
  // "ddd" gives Sun/Mon in English, short names in other languages.
  renderWeekdays(el, start) {
    const weekdaysEl = el.createDiv({ cls: "sc-weekdays" });
    for (let i = 0; i < 7; i++) {
      weekdaysEl.createDiv({
        cls: "sc-weekday",
        text: start.clone().add(i, "day").format("ddd"),
      });
    }
  }

  renderGrid(el, start, end) {
    const s = this.plugin.settings;
    const today = moment();
    const grid = el.createDiv({ cls: "sc-grid" });
    const day = start.clone();
    while (day.isSameOrBefore(end, "day")) {
      const date = day.clone();
      const cell = grid.createDiv({ cls: "sc-day" });

      if (!date.isSame(this.displayed, "month")) cell.addClass("sc-outside");
      if (date.isSame(today, "day")) cell.addClass("sc-today");

      cell.createDiv({ cls: "sc-day-num", text: String(date.date()) });

      // The core feature: mark days that have a daily note.
      if (s.showDots) {
        const dotWrap = cell.createDiv({ cls: "sc-dot-wrap" });
        if (this.notesByDay.has(date.format(DAY_KEY))) {
          cell.addClass("sc-has-note");
          if (s.marker === "symbol") {
            dotWrap.createDiv({ cls: "sc-symbol", text: s.symbol || "✓" });
          } else {
            dotWrap.createDiv({ cls: "sc-dot" });
          }
        }
      }

      cell.addEventListener("click", () => this.openDailyNote(date));
      day.add(1, "day");
    }
  }

  // Open the daily note for the clicked day.
  // If it doesn't exist, create it (using the template) and open it.
  async openDailyNote(date) {
    const file =
      (this.notesByDay && this.notesByDay.get(date.format(DAY_KEY))) ||
      (await this.createDailyNote(date));
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  async createDailyNote(date) {
    const { format, folder, template } = getDailyNoteSettings(this.app);

    // If the format includes a time part, fill it with the current time.
    const now = moment();
    const stamp = date.clone().set({
      hour: now.hour(),
      minute: now.minute(),
      second: now.second(),
    });
    const path = normalizePath(
      (folder ? folder + "/" : "") + stamp.format(format) + ".md"
    );

    // Create the parent folder if it doesn't exist.
    const dir = path.substring(0, path.lastIndexOf("/"));
    if (dir && !this.app.vault.getAbstractFileByPath(dir)) {
      await this.app.vault.createFolder(dir).catch(() => {});
    }

    // Start from the daily note template, if one is configured.
    let content = "";
    if (template) {
      const tPath = normalizePath(
        template.endsWith(".md") ? template : template + ".md"
      );
      const tFile = this.app.vault.getAbstractFileByPath(tPath);
      if (tFile instanceof TFile) content = await this.app.vault.read(tFile);
    }

    return this.app.vault.create(path, content);
  }
}

// ── Settings tab: simple appearance options only ──
class SimpleCalendarSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Mark days with a daily note")
      .setDesc("Show a marker under days that have a daily note.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showDots).onChange(async (v) => {
          this.plugin.settings.showDots = v;
          await this.plugin.saveSettings();
          this.display(); // show/hide the marker options below
        })
      );

    new Setting(containerEl)
      .setName("Days outside this month")
      .setDesc("How to display days that belong to the previous or next month.")
      .addDropdown((d) =>
        d
          .addOption("dim", "Dim")
          .addOption("show", "Show normally")
          .addOption("hide", "Hide")
          .setValue(this.plugin.settings.outsideDays)
          .onChange(async (v) => {
            this.plugin.settings.outsideDays = v;
            await this.plugin.saveSettings();
          })
      );

    // Marker appearance options only make sense while the marker is on.
    if (!this.plugin.settings.showDots) return;

    new Setting(containerEl)
      .setName("Marker style")
      .setDesc("A small dot, or any character you like.")
      .addDropdown((d) =>
        d
          .addOption("dot", "Dot")
          .addOption("symbol", "Symbol")
          .setValue(this.plugin.settings.marker)
          .onChange(async (v) => {
            this.plugin.settings.marker = v;
            await this.plugin.saveSettings();
            this.display(); // show/hide the symbol input
          })
      );

    if (this.plugin.settings.marker === "symbol") {
      new Setting(containerEl)
        .setName("Symbol")
        .setDesc("Any character or emoji, e.g. ✓ ★ ♥ 🔥")
        .addText((t) =>
          t.setValue(this.plugin.settings.symbol).onChange(async (v) => {
            this.plugin.settings.symbol = v.trim().slice(0, 4) || "✓";
            await this.plugin.saveSettings();
          })
        );
    }

    new Setting(containerEl)
      .setName("Use theme color for marker")
      .setDesc("The marker follows your theme's accent color.")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.useThemeDotColor)
          .onChange(async (v) => {
            this.plugin.settings.useThemeDotColor = v;
            await this.plugin.saveSettings();
            this.display(); // show/hide the color picker
          })
      );

    if (!this.plugin.settings.useThemeDotColor) {
      new Setting(containerEl).setName("Marker color").addColorPicker((c) =>
        c.setValue(this.plugin.settings.dotColor).onChange(async (v) => {
          this.plugin.settings.dotColor = v;
          await this.plugin.saveSettings();
        })
      );
    }

    new Setting(containerEl).setName("Marker size").addSlider((sl) =>
      sl
        .setLimits(3, 9, 1)
        .setValue(this.plugin.settings.dotSize)
        .setDynamicTooltip()
        .onChange(async (v) => {
          this.plugin.settings.dotSize = v;
          await this.plugin.saveSettings();
        })
    );
  }
}

class SimpleCalendarPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new SimpleCalendarSettingTab(this.app, this));

    this.registerView(VIEW_TYPE, (leaf) => new SimpleCalendarView(leaf, this));

    this.addRibbonIcon("calendar-days", "Open Simple Calendar", () =>
      this.activateView()
    );

    this.addCommand({
      id: "open-simple-calendar",
      name: "Open calendar",
      callback: () => this.activateView(),
    });

    // Attach the view to the right sidebar once the layout is ready.
    this.app.workspace.onLayoutReady(() => {
      // A leaf restored from the previous session can still be deferred
      // here and race with this auto-attach, ending up with two
      // calendars; keep the first leaf and close any extras.
      const leaves = this.getCalendarLeaves();
      for (const extra of leaves.slice(1)) extra.detach();
      if (leaves.length === 0) {
        const leaf = this.app.workspace.getRightLeaf(false);
        if (leaf) leaf.setViewState({ type: VIEW_TYPE });
      }
    });
  }

  // Find calendar leaves by their saved view state instead of the live
  // view object, so leaves that are still deferred at startup count too.
  getCalendarLeaves() {
    const leaves = [];
    this.app.workspace.iterateAllLeaves((leaf) => {
      const state = leaf.getViewState();
      if (state && state.type === VIEW_TYPE) leaves.push(leaf);
    });
    return leaves;
  }

  async loadSettings() {
    const data = (await this.loadData()) || {};
    // Migrate the old "dim" toggle to the new three-way option.
    if (data.dimOutsideDays !== undefined && data.outsideDays === undefined) {
      data.outsideDays = data.dimOutsideDays ? "dim" : "show";
      delete data.dimOutsideDays;
    }
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
  }

  // Save, then re-render any open calendars so changes apply instantly.
  async saveSettings() {
    await this.saveData(this.settings);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof SimpleCalendarView) leaf.view.render();
    }
  }

  async activateView() {
    const leaves = this.getCalendarLeaves();
    for (const extra of leaves.slice(1)) extra.detach();
    let leaf = leaves[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }
}

module.exports = SimpleCalendarPlugin;

// Internal functions exposed for tests (ignored by Obsidian).
module.exports.__test = {
  getDailyNoteSettings,
  stripWeekdayTokens,
  getNotesByDay,
};
