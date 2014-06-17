/* global console */
import MarkerManager from 'ghost/mixins/marker-manager';
import PostModel from 'ghost/models/post';
import boundOneWay from 'ghost/utils/bound-one-way';

// this array will hold properties we need to watch
// to know if the model has been changed (`controller.isDirty`)
var watchedProps = ['scratch', 'model.isDirty'];

Ember.get(PostModel, 'attributes').forEach(function (name) {
    watchedProps.push('model.' + name);
});

// watch if number of tags changes on the model
watchedProps.push('tags.[]');

var EditorControllerMixin = Ember.Mixin.create(MarkerManager, {
    /**
     * By default, a post will not change its publish state.
     * Only with a user-set value (via setSaveType action)
     * can the post's status change.
     */
    willPublish: boundOneWay('isPublished'),

    // set by the editor route and `isDirty`. useful when checking
    // whether the number of tags has changed for `isDirty`.
    previousTagNames: null,

    tagNames: function () {
        return this.get('tags').mapBy('name');
    }.property('tags.[]'),

    // compares previousTagNames to tagNames
    tagNamesEqual: function () {
        var tagNames = this.get('tagNames'),
            previousTagNames = this.get('previousTagNames'),
            hashCurrent,
            hashPrevious;

        // beware! even if they have the same length,
        // that doesn't mean they're the same.
        if (tagNames.length !== previousTagNames.length) {
            return false;
        }

        // instead of comparing with slow, nested for loops,
        // perform join on each array and compare the strings
        hashCurrent = tagNames.join('');
        hashPrevious = previousTagNames.join('');

        return hashCurrent === hashPrevious;
    },

    // an ugly hack, but necessary to watch all the model's properties
    // and more, without having to be explicit and do it manually
    isDirty: Ember.computed.apply(Ember, watchedProps.concat(function (key, value) {
        if (arguments.length > 1) {
            return value;
        }

        var model = this.get('model'),
            markdown = this.get('markdown'),
            scratch = this.getMarkdown().withoutMarkers,
            changedAttributes;

        if (!this.tagNamesEqual()) {
            this.set('previousTagNames', this.get('tagNames'));
            return true;
        }

        // since `scratch` is not model property, we need to check
        // it explicitly against the model's markdown attribute
        if (markdown !== scratch) {
            return true;
        }

        // models created on the client always return `isDirty: true`,
        // so we need to see which properties have actually changed.
        if (model.get('isNew')) {
            changedAttributes = Ember.keys(model.changedAttributes());

            if (changedAttributes.length) {
                return true;
            }

            return false;
        }

        // even though we use the `scratch` prop to show edits,
        // which does *not* change the model's `isDirty` property,
        // `isDirty` will tell us if the other props have changed,
        // as long as the model is not new (model.isNew === false).
        if (model.get('isDirty')) {
            return true;
        }

        return false;
    })),

    // used on window.onbeforeunload
    unloadDirtyMessage: function () {
        return '==============================\n\n' +
            'Hey there! It looks like you\'re in the middle of writing' +
            ' something and you haven\'t saved all of your content.' +
            '\n\nSave before you go!\n\n' +
            '==============================';
    },

    // remove client-generated tags, which have `id: null`.
    // Ember Data won't recognize/update them automatically
    // when returned from the server with ids.
    updateTags: function () {
        var tags = this.get('model.tags'),
            oldTags = tags.filterBy('id', null);

        tags.removeObjects(oldTags);
        oldTags.invoke('deleteRecord');
    },
    actions: {
        save: function () {
            var status = this.get('willPublish') ? 'published' : 'draft',
                self = this;

            // set markdown equal to what's in the editor, minus the image markers.
            this.set('markdown', this.getMarkdown().withoutMarkers);

            this.set('status', status);
            return this.get('model').save().then(function (model) {
                self.updateTags();
                // `updateTags` triggers `isDirty => true`.
                // for a saved model it would otherwise be false.
                self.set('isDirty', false);

                self.notifications.showSuccess('Post status saved as <strong>' +
                    model.get('status') + '</strong>.');
                return model;
            }, this.notifications.showErrors);
        },

        setSaveType: function (newType) {
            if (newType === 'publish') {
                this.set('willPublish', true);
            } else if (newType === 'draft') {
                this.set('willPublish', false);
            } else {
                console.warn('Received invalid save type; ignoring.');
            }
        },

        // set from a `sendAction` on the codemirror component,
        // so that we get a reference for handling uploads.
        setCodeMirror: function (codemirrorComponent) {
            var codemirror = codemirrorComponent.get('codemirror');

            this.set('codemirrorComponent', codemirrorComponent);
            this.set('codemirror', codemirror);
        },

        // fired from the gh-markdown component when an image upload starts
        disableCodeMirror: function () {
            this.get('codemirrorComponent').disableCodeMirror();
        },

        // fired from the gh-markdown component when an image upload finishes
        enableCodeMirror: function () {
            this.get('codemirrorComponent').enableCodeMirror();
        },

        // Match the uploaded file to a line in the editor, and update that line with a path reference
        // ensuring that everything ends up in the correct place and format.
        handleImgUpload: function (e, result_src) {
            var editor = this.get('codemirror'),
                line = this.findLine(Ember.$(e.currentTarget).attr('id')),
                lineNumber = editor.getLineNumber(line),
                match = line.text.match(/\([^\n]*\)?/),
                replacement = '(http://)';

            if (match) {
                // simple case, we have the parenthesis
                editor.setSelection(
                    {line: lineNumber, ch: match.index + 1},
                    {line: lineNumber, ch: match.index + match[0].length - 1}
                );
            } else {
                match = line.text.match(/\]/);
                if (match) {
                    editor.replaceRange(
                        replacement,
                        {line: lineNumber, ch: match.index + 1},
                        {line: lineNumber, ch: match.index + 1}
                    );
                    editor.setSelection(
                        {line: lineNumber, ch: match.index + 2},
                        {line: lineNumber, ch: match.index + replacement.length }
                    );
                }
            }
            editor.replaceSelection(result_src);
        }
    }
});

export default EditorControllerMixin;
