# Stedule

A calendar application that saves its data in a local .ics file.

The goal of this application is to provide an alternative to Google Calendar that does not depend on storing your data on a proprietary cloud. Instead, you have full control over your data, and you choose if and how to sync it.

For example, you could use the OSS [Syncthing](https://syncthing.net/).

## Changelog

- `260506, v0.1.0:` First usable Android version
- `260505, v0.0.4:` Successful Tauri test on Android
- `260503, v0.0.3:` Usable functionality
- `260425, v0.0.2:` Add week view
- `260424, v0.0.1:` Import Claude-generated scaffolding for the project

## Run

### Try it out on localhost

Run the following line in a terminal from this folder (stedule/).
```
python -m http.server 8080
```

And navigate to http://localhost:8080 on the browser of your choice.
Click on "Open .ics file" to open your calendar. 

Updating the calendar (by editing or adding an event) will write the changes to the same file on a Chromium Browser.
On Firefox Browsers, a download will be triggered, allowing you to replace the original file with the new downloaded file.

### Android, Linux, Windows Build

Coming soon...

### Apple Build

Not planned, because I don't own any Apple devices. But feel free to contribute or reach out to me if you think that the world needs it.

## Future features
- [x] Week view
- [x] Tauri packaging for Android
- [x] Recurring events
- [ ] Dark mode
- [ ] Settings page
- [ ] Support for Linux
- [ ] Support for Windows

---

<div style="text-align:center;">
⢠⡶⠛⠛⠛⠛⣤  <br>
⠻⣦⣴⣿⣤⣤⡀  <br>
⣼⠃⠀⣿⠀⢀⡟  <br>
⠉⠛⠛⣿⠛⠉⣠  <br>
⠀⠀⠀⣿⠀⠀⢶  <br>
</div>