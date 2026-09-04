const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Clutter = imports.gi.Clutter;
const Mainloop = imports.mainloop;
const Util = imports.misc.util;
const Settings = imports.ui.settings;
const ByteArray = imports.byteArray;


function TodoTxtDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}


TodoTxtDesklet.prototype = {

    __proto__: Desklet.Desklet.prototype,


    /*
     * ------------------------------------------------------------------------
     * Initialisation
     * ------------------------------------------------------------------------
     */

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(
            this,
            metadata,
            desklet_id
        );

        this.metadata = metadata;
        this.desklet_id = desklet_id;

        this.settings = new Settings.DeskletSettings(
            this,
            metadata.uuid,
            desklet_id
        );

        this._refreshTimer = null;
        this._currentRefreshInterval = null;

        this._bindSettings();
        this._buildUI();

        this.setHeader("Todo.txt");

        this.actor.connect(
            "button-release-event",
            this._onClicked.bind(this)
        );

        this._readTodoFile();
        this._startRefreshTimer();
    },


    _bindSettings: function() {
        let settings = [
            "todo-file",
            "show-completed",
            "show-task-count",
            "show-priority",
            "show-creation-date",
            "show-due-date",
            "show-projects",
            "show-contexts",
            "show-other-tags",
            "show-tags-below",
            "align-tags-right",
            "rounded-tags",
            "underline-due",
            "font-size",
            "task-spacing",
            "refresh-interval"
        ];

        for (let i = 0; i < settings.length; i++) {
            this.settings.bind(
                settings[i],
                this._settingName(settings[i]),
                this._settingsChanged.bind(this)
            );
        }
    },


    _settingName: function(name) {
        return name.replace(
            /-([a-z])/g,
            function(match, letter) {
                return letter.toUpperCase();
            }
        );
    },


    /*
     * ------------------------------------------------------------------------
     * User interface
     * ------------------------------------------------------------------------
     */

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

        this._applyAppearance();
    },


    _settingsChanged: function() {
        let newInterval = this._getRefreshInterval();

        this._applyAppearance();
        this._readTodoFile();

        if (newInterval !== this._currentRefreshInterval) {
            this._startRefreshTimer();
        }
    },


    _applyAppearance: function() {
        if (!this._taskBox)
            return;

        let fontSize = parseInt(this.fontSize, 10);
        if (isNaN(fontSize))
            fontSize = 12;

        let spacing = parseInt(this.taskSpacing, 10);
        if (isNaN(spacing))
            spacing = 6;

        this._taskBox.set_style(
            "font-size: " + fontSize + "px; " +
            "spacing: " + spacing + "px;"
        );
    },


    /*
     * ------------------------------------------------------------------------
     * Refresh handling
     * ------------------------------------------------------------------------
     */

    _getRefreshInterval: function() {
        let interval = parseInt(this.refreshInterval, 10);

        if (isNaN(interval) || interval < 1)
            interval = 10;

        return interval;
    },


    _startRefreshTimer: function() {
        this._stopRefreshTimer();

        this._currentRefreshInterval =
            this._getRefreshInterval();

        this._refreshTimer = Mainloop.timeout_add_seconds(
            this._currentRefreshInterval,
            () => {
                this._readTodoFile();
                return true;
            }
        );
    },


    _stopRefreshTimer: function() {
        if (this._refreshTimer) {
            Mainloop.source_remove(this._refreshTimer);
            this._refreshTimer = null;
        }

        this._currentRefreshInterval = null;
    },


    /*
     * ------------------------------------------------------------------------
     * File handling
     * ------------------------------------------------------------------------
     */

    _expandPath: function(path) {
        if (!path)
            return null;

        path = String(path).trim();

        if (path.length === 0)
            return null;

        if (path.startsWith("file://")) {
            try {
                let file = Gio.file_new_for_uri(path);
                return file.get_path();
            } catch (e) {
                global.logError(
                    "Unable to convert file URI: " + path
                );

                return null;
            }
        }

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


    _readTodoFile: function() {
        let path = this._expandPath(this.todoFile);

        if (!path) {
            this._showError(
                "No todo.txt file selected."
            );

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

            let result = GLib.file_get_contents(path);

            if (!result[0]) {
                this._showError(
                    "Unable to read todo.txt"
                );

                return;
            }

            let text = ByteArray.toString(result[1]);

            this._displayTasks(text);

        } catch (e) {
            this._showError(
                "Error reading todo.txt:\n" + e
            );
        }
    },


    /*
     * ------------------------------------------------------------------------
     * Displaying tasks
     * ------------------------------------------------------------------------
     */

    _displayTasks: function(text) {
        this._taskBox.destroy_all_children();

        let lines = text.split(/\r?\n/);
        let taskCount = 0;

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();

            if (!line)
                continue;

            /*
             * todo.txt comments
             */
            if (line.startsWith("#"))
                continue;

            let task = this._parseTask(line);

            if (task.completed && !this.showCompleted)
                continue;

            this._addTask(task);
            taskCount++;
        }

        if (taskCount === 0) {
            this._taskBox.add_child(
                new St.Label({
                    text: "No tasks",
                    style_class: "todotxt-empty"
                })
            );
        }

        this._title.set_text(
            this.showTaskCount
                ? "Todo.txt (" + taskCount + ")"
                : "Todo.txt"
        );

        this._applyAppearance();
    },


    _addTask: function(task) {
        let row = new St.BoxLayout({
            vertical: true,
            style_class: "todotxt-task"
        });

        row.add_child(this._createTaskLine(task));

        if (this.showTagsBelow) {
            let metadata = this._createMetadata(task);

            if (metadata)
                row.add_child(metadata);
        }

        this._taskBox.add_child(row);
    },


    _createTaskLine: function(task) {
        let taskLine = new St.BoxLayout({
            vertical: false,
            style_class: "todotxt-task-line"
        });

        let marker = task.completed ? "✓" : "○";

        let markerLabel = new St.Label({
            text: marker,
            style_class: task.completed
                ? "todotxt-marker-completed"
                : "todotxt-marker"
        });

        markerLabel.set_width(24);

        taskLine.add_child(markerLabel);

        if (this.showPriority && task.priority) {
            taskLine.add_child(
                new St.Label({
                    text: "(" + task.priority + ")",
                    style_class: "todotxt-marker"
                })
            );
        }

        let textLabel = new St.Label({
            text: task.text,
            style_class: task.completed
                ? "todotxt-task-completed"
                : "todotxt-task-text"
        });

        textLabel.clutter_text.line_wrap = true;

        taskLine.add_child(
            textLabel,
            { expand: true }
        );

        return taskLine;
    },


    _createMetadata: function(task) {
        let hasDate =
            (
                this.showCreationDate &&
                task.creationDate
            ) ||
            (
                this.showDueDate &&
                task.dueDate
            );

        let hasTags =
            (
                this.showProjects &&
                task.projects.length > 0
            ) ||
            (
                this.showContexts &&
                task.contexts.length > 0
            ) ||
            (
                this.showOtherTags &&
                task.otherTags.length > 0
            );

        if (!hasDate && !hasTags)
            return null;

        let metadata = new St.BoxLayout({
            vertical: false,
            style_class: "todotxt-metadata"
        });

        if (this.alignTagsRight) {
            metadata.add_child(
                new St.Widget({
                    x_expand: true
                })
            );
        }

        this._addDateMetadata(metadata, task);
        this._addTagMetadata(metadata, task);

        return metadata;
    },


    _addDateMetadata: function(metadata, task) {
        if (
            this.showCreationDate &&
            task.creationDate
        ) {
            metadata.add_child(
                new St.Label({
                    text:
                        "Created " +
                        this._formatDate(task.creationDate),
                    style_class: "todotxt-date"
                })
            );
        }

        if (
            this.showDueDate &&
            task.dueDate
        ) {
            let days = this._daysBetween(
                this._getToday(),
                task.dueDate
            );

            let style = "todotxt-due";

            if (days !== null) {
                if (days < 0) {
                    style = "todotxt-due-overdue";
                } else if (days <= 2) {
                    style = "todotxt-due-soon";
                }
            }

            let dueLabel = new St.Label({
                text:
                    "Due " +
                    this._formatDate(task.dueDate),
                style_class: style
            });

            if (!this.underlineDue) {
                dueLabel.set_style(
                    "text-decoration: none;"
                );
            }

            metadata.add_child(dueLabel);
        }
    },


    _addTagMetadata: function(metadata, task) {
        if (
            this.showProjects &&
            task.projects.length > 0
        ) {
            this._addTags(
                metadata,
                task.projects,
                "todotxt-project"
            );
        }

        if (
            this.showContexts &&
            task.contexts.length > 0
        ) {
            this._addTags(
                metadata,
                task.contexts,
                "todotxt-context"
            );
        }

        if (
            this.showOtherTags &&
            task.otherTags.length > 0
        ) {
            this._addTags(
                metadata,
                task.otherTags,
                "todotxt-other-tag"
            );
        }
    },


    _addTags: function(container, tags, styleClass) {
        for (let i = 0; i < tags.length; i++) {
            container.add_child(
                this._createTag(
                    tags[i],
                    styleClass
                )
            );
        }
    },


    _createTag: function(text, styleClass) {
        let label = new St.Label({
            text: text,
            style_class:
                "todotxt-tag " + styleClass
        });

        if (!this.roundedTags) {
            label.set_style(
                "border-radius: 0px;"
            );
        }

        return label;
    },


    /*
     * ------------------------------------------------------------------------
     * todo.txt parsing
     * ------------------------------------------------------------------------
     */

    _parseTask: function(line) {
        let task = {
            completed: false,
            completionDate: null,
            creationDate: null,
            priority: null,
            dueDate: null,
            projects: [],
            contexts: [],
            otherTags: [],
            text: ""
        };

        /*
         * Completed task
         *
         * A completed task begins with:
         *
         * x YYYY-MM-DD ...
         */
        if (/^x\s+/i.test(line)) {
            task.completed = true;

            line = line.replace(/^x\s+/i, "");

            let completion = line.match(
                /^(\d{4}-\d{2}-\d{2})\s+/
            );

            if (completion) {
                task.completionDate = completion[1];

                line = line.substring(
                    completion[0].length
                );
            }
        }

        /*
         * Creation date
         */
        let creation = line.match(
            /^(\d{4}-\d{2}-\d{2})\s+/
        );

        if (creation) {
            task.creationDate = creation[1];

            line = line.substring(
                creation[0].length
            );
        }

        /*
         * Priority
         */
        let priority = line.match(
            /^\(([A-Z])\)\s+/
        );

        if (priority) {
            task.priority = priority[1];

            line = line.substring(
                priority[0].length
            );
        }

        /*
         * Remaining tokens
         */
        let tokens = line.split(/\s+/);
        let textTokens = [];

        for (let i = 0; i < tokens.length; i++) {
            let token = tokens[i];

            /*
             * URLs must be checked before generic
             * key:value tags.
             *
             * Otherwise:
             *
             *     http://todotxt.org
             *
             * would be mistaken for an "http:" tag.
             */
            if (/^https?:\/\/\S+$/i.test(token)) {
                textTokens.push(token);
                continue;
            }

            /*
             * Due date
             */
            if (/^due:\d{4}-\d{2}-\d{2}$/i.test(token)) {
                task.dueDate = token.substring(4);
                continue;
            }

            /*
             * Project
             */
            if (/^\+[^\s]+$/.test(token)) {
                task.projects.push(token);
                continue;
            }

            /*
             * Context
             */
            if (/^@[^\s]+$/.test(token)) {
                task.contexts.push(token);
                continue;
            }

            /*
             * Other key:value tags
             */
            if (
                /^[A-Za-z][A-Za-z0-9_-]*:[^\s]+$/.test(token)
            ) {
                task.otherTags.push(token);
                continue;
            }

            textTokens.push(token);
        }

        task.text = textTokens.join(" ");

        return task;
    },


    /*
     * ------------------------------------------------------------------------
     * Date helpers
     * ------------------------------------------------------------------------
     */

    _formatDate: function(date) {
        if (!date)
            return "";

        let parts = date.split("-");

        if (parts.length !== 3)
            return date;

        return (
            parseInt(parts[2], 10) +
            " " +
            this._monthName(
                parseInt(parts[1], 10)
            ) +
            " " +
            parts[0]
        );
    },


    _monthName: function(month) {
        let months = [
            "",
            "Jan",
            "Feb",
            "Mar",
            "Apr",
            "May",
            "Jun",
            "Jul",
            "Aug",
            "Sep",
            "Oct",
            "Nov",
            "Dec"
        ];

        return months[month] || "";
    },


    _getToday: function() {
        let now = new Date();

        return (
            now.getFullYear() +
            "-" +
            String(now.getMonth() + 1).padStart(2, "0") +
            "-" +
            String(now.getDate()).padStart(2, "0")
        );
    },


    _isValidDate: function(date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
            return false;

        let parts = date.split("-");

        let year = parseInt(parts[0], 10);
        let month = parseInt(parts[1], 10) - 1;
        let day = parseInt(parts[2], 10);

        let test = new Date(
            year,
            month,
            day
        );

        return (
            test.getFullYear() === year &&
            test.getMonth() === month &&
            test.getDate() === day
        );
    },


    _daysBetween: function(date1, date2) {
        if (
            !this._isValidDate(date1) ||
            !this._isValidDate(date2)
        ) {
            return null;
        }

        let a = new Date(
            date1 + "T00:00:00"
        );

        let b = new Date(
            date2 + "T00:00:00"
        );

        return Math.round(
            (b - a) / 86400000
        );
    },


    /*
     * ------------------------------------------------------------------------
     * Error handling
     * ------------------------------------------------------------------------
     */

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


    /*
     * ------------------------------------------------------------------------
     * Desklet interaction
     * ------------------------------------------------------------------------
     */

    _onClicked: function(actor, event) {
        let button = event.get_button();

        if (button !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;

        let path = this._expandPath(
            this.todoFile
        );

        if (!path)
            return Clutter.EVENT_STOP;

        try {
            Util.spawn([
                "xdg-open",
                path
            ]);
        } catch (e) {
            global.logError(
                "Unable to open todo.txt: " + e
            );
        }

        return Clutter.EVENT_STOP;
    },


    /*
     * ------------------------------------------------------------------------
     * Cleanup
     * ------------------------------------------------------------------------
     */

    on_desklet_removed: function() {
        this._stopRefreshTimer();
    }
};


function main(metadata, desklet_id) {
    return new TodoTxtDesklet(
        metadata,
        desklet_id
    );
}