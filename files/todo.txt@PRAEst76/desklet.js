const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Clutter = imports.gi.Clutter;
const Mainloop = imports.mainloop;
const Util = imports.misc.util;
const Settings = imports.ui.settings;

function TodoTxtDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

TodoTxtDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this.metadata = metadata;
        this.desklet_id = desklet_id;

        this.settings = new Settings.DeskletSettings(
            this,
            metadata.uuid,
            desklet_id
        );

        this.settings.bind(
            "todo-file",
            "todoFile",
            this._settingsChanged.bind(this)
        );

        this.settings.bind(
            "show-completed",
            "showCompleted",
            this._settingsChanged.bind(this)
        );

        this.settings.bind(
            "show-priority",
            "showPriority",
            this._settingsChanged.bind(this)
        );

        this.settings.bind(
            "show-projects",
            "showProjects",
            this._settingsChanged.bind(this)
        );

        this.settings.bind(
            "show-contexts",
            "showContexts",
            this._settingsChanged.bind(this)
        );

        this.settings.bind(
            "refresh-interval",
            "refreshInterval",
            this._settingsChanged.bind(this)
        );

        this.settings.bind(
            "font-size",
            "fontSize",
            this._settingsChanged.bind(this)
        );

        this._refreshTimer = null;

        this._buildUI();
        this._update();

        this.setHeader("Todo.txt");

        // Clicking the desklet opens the todo.txt file.
        this.actor.connect(
            "button-release-event",
            this._onClicked.bind(this)
        );
    },

    _buildUI: function() {
        this._mainBox = new St.BoxLayout({
            vertical: true,
            style_class: "todotxt-container"
        });

        this._title = new St.Label({
            text: "Todo.txt",
            style_class: "todotxt-title"
        });

        this._mainBox.add_child(this._title);

        this._taskBox = new St.BoxLayout({
            vertical: true,
            style_class: "todotxt-tasks"
        });

        this._mainBox.add_child(this._taskBox);

        this.setContent(this._mainBox);
    },

    _settingsChanged: function() {
        this._applyFontSize();
        this._update();
    },

    _applyFontSize: function() {
        if (!this._taskBox)
            return;

        this._taskBox.set_style(
            "font-size: " + this.fontSize + "px;"
        );
    },

    _expandPath: function(path) {
    if (!path)
        return null;

    path = String(path).trim();

    if (path.length === 0)
        return null;

    // Cinnamon's filechooser can return a file:// URI.
    if (path.startsWith("file://")) {
        try {
            let file = Gio.file_new_for_uri(path);
            return file.get_path();
        }
        catch (e) {
            global.logError(
                "Unable to convert file URI: " + path
            );
            return null;
        }
    }

    // Expand ~/ if necessary.
    if (path === "~")
        return GLib.get_home_dir();

    if (path.startsWith("~/")) {
        return GLib.build_filenamev([
            GLib.get_home_dir(),
            path.substring(2)
        ]);
    }

    return path;
    },

    _update: function() {
        if (this._refreshTimer) {
            Mainloop.source_remove(this._refreshTimer);
            this._refreshTimer = null;
        }

        this._readTodoFile();

        let interval = parseInt(this.refreshInterval);

        if (isNaN(interval) || interval < 1)
            interval = 10;

        this._refreshTimer = Mainloop.timeout_add_seconds(
            interval,
            () => {
                this._readTodoFile();
                return true;
            }
        );
    },

    _readTodoFile: function() {
        let path = this._expandPath(this.todoFile);

        if (!path) {
            this._showError("No todo.txt file selected.");
            return;
        }

        let file = Gio.file_new_for_path(path);

        try {
            if (!file.query_exists(null)) {
                this._showError(
                    "File not found:\n" + path
                );
                return;
            }

            let [success, contents] =
                GLib.file_get_contents(path);

            if (!success) {
                this._showError("Unable to read todo.txt");
                return;
            }

            let text;

            if (contents instanceof Uint8Array) {
                text = imports.byteArray.toString(contents);
            } else {
                text = contents.toString();
            }

            this._displayTasks(text);
        }
        catch (e) {
            this._showError(
                "Error reading todo.txt:\n" + e
            );
        }
    },

    _displayTasks: function(text) {
        this._taskBox.destroy_all_children();

        let lines = text.split(/\r?\n/);

        let taskCount = 0;

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();

            // Ignore empty lines.
            if (line.length === 0)
                continue;

            // Ignore comments.
            if (line.startsWith("#"))
                continue;

            let completed = /^x\s+/i.test(line);

            if (completed && !this.showCompleted)
                continue;

            let task = this._parseTask(line, completed);

            this._addTask(task);

            taskCount++;
        }

        if (taskCount === 0) {
            let emptyLabel = new St.Label({
                text: "No tasks",
                style_class: "todotxt-empty"
            });

            this._taskBox.add_child(emptyLabel);
        }

        this._title.set_text(
            "Todo.txt (" + taskCount + ")"
        );

        this._applyFontSize();
    },

    _parseTask: function(line, completed) {
        let task = {
            text: line,
            completed: completed,
            priority: null
        };

        if (completed) {
            // Remove the completed marker.
            task.text = task.text.replace(
                /^x\s+/i,
                ""
            );

            // Standard todo.txt completed tasks can
            // contain a completion date followed by
            // an optional creation date.
            task.text = task.text.replace(
                /^\d{4}-\d{2}-\d{2}\s+/,
                ""
            );

            task.text = task.text.replace(
                /^\d{4}-\d{2}-\d{2}\s+/,
                ""
            );
        }

        // Detect priority.
        let priorityMatch =
            task.text.match(/^\(([A-Z])\)\s+/);

        if (priorityMatch) {
            task.priority = priorityMatch[1];

            if (!this.showPriority) {
                task.text = task.text.replace(
                    /^\([A-Z]\)\s+/,
                    ""
                );
            }
        }

        if (!this.showProjects) {
            task.text = task.text.replace(
                /(^|\s)\+[A-Za-z0-9_-]+/g,
                ""
            );
        }

        if (!this.showContexts) {
            task.text = task.text.replace(
                /(^|\s)@[A-Za-z0-9_-]+/g,
                ""
            );
        }

        // Clean up whitespace introduced by
        // removing projects/contexts.
        task.text = task.text
            .replace(/\s+/g, " ")
            .trim();

        return task;
    },

    _addTask: function(task) {
        let row = new St.BoxLayout({
            vertical: false,
            style_class: "todotxt-task"
        });

        let marker;

        if (task.completed) {
            marker = "✓";
        } else if (task.priority) {
            marker = "●";
        } else {
            marker = "○";
        }

        let markerLabel = new St.Label({
            text: marker,
            style_class: task.completed
                ? "todotxt-marker-completed"
                : "todotxt-marker"
        });

        markerLabel.set_width(24);

        row.add_child(markerLabel);

        let textLabel = new St.Label({
            text: task.text,
            style_class: task.completed
                ? "todotxt-task-completed"
                : "todotxt-task-text",
            reactive: false
        });

        textLabel.clutter_text.line_wrap = true;

        row.add_child(textLabel, {
            expand: true
        });

        if (task.priority && this.showPriority) {
            row.add_style_class_name(
                "priority-" + task.priority.toLowerCase()
            );
        }

        this._taskBox.add_child(row);
    },

    _showError: function(message) {
        this._taskBox.destroy_all_children();

        let errorLabel = new St.Label({
            text: message,
            style_class: "todotxt-error"
        });

        errorLabel.clutter_text.line_wrap = true;

        this._taskBox.add_child(errorLabel);

        this._title.set_text("Todo.txt");
    },

    _onClicked: function(actor, event) {
        let button = event.get_button();

        if (button !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;

        let path = this._expandPath(this.todoFile);

        if (!path)
            return Clutter.EVENT_STOP;

        try {
            Util.spawn([
                "xdg-open",
                path
            ]);
        }
        catch (e) {
            global.logError(
                "Unable to open todo.txt: " + e
            );
        }

        return Clutter.EVENT_STOP;
    },

    on_desklet_removed: function() {
        if (this._refreshTimer) {
            Mainloop.source_remove(this._refreshTimer);
            this._refreshTimer = null;
        }
    }
};

function main(metadata, desklet_id) {
    return new TodoTxtDesklet(metadata, desklet_id);
}