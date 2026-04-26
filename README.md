# Stedule

A calendar application that saves its data in a local .ics file.

## Run

Run the following line in a terminal from this folder (stedule/).
```
python -m http.server 8080
```

And navigate to http://localhost:8080 on the browser of your choice.
Click on "Open .ics file" to open your calendar. 

Updating the calendar (by editing or adding an event) will write the changes to the same file on a Chromium Browser.
On Firefox Browsers, a download will be triggered, allowing you to replace the original file with the new downloaded file.

## Changelog

- `260424` Import Claude-generated scaffolding for the project
- `260425` Add week view

## Future features
- [x] Week view
- [ ] Dark mode
- [ ] Tauri packaging
- [ ] Recurring events
- [ ] Reload button
- [ ] Settings page
- [ ] Drag to reschedule
