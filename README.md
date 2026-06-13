# Stedule

<img align="left" src="images/logoStedule01.2.png" alt="Stedule Logo" width="100">
  
A calendar application that saves its data in a local .ics file.

The goal of this application is to provide an alternative to Google Calendar that does not depend on storing your data on a proprietary cloud. Instead, you have full control over your data, and you choose if and how to sync it.

For example, you could use the OSS [Syncthing](https://syncthing.net/).

## Changelog
- 260613, **v0.3.1-alpha**: Introduce now-indicator; improve multi-day UI; fix navigation resetting scroll; fix firefox warning on Android
- 260613, **v0.3.0-alpha**: Introduce exceptions to rrule
- 260611, **v0.2.3-alpha**: Prevent bad user input for time; time input UX improvement
- 260531, **v0.2.2-alpha**: Major bugfixes for notifications
- 260530, **v0.2.1-alpha**: Introduce event notifications
- 260512, **v0.1.2-alpha**: Introduce multi-day events; fix formatting
- 260508, **v0.1.1-alpha**: Introduce dark mode and quick add; major bugfixes
- 260506, **v0.1.0-alpha**: First usable Android version
- 260505, **v0.0.4-alpha**: Successful Tauri test on Android
- 260503, **v0.0.3-alpha**: Usable functionality
- 260425, **v0.0.2-alpha**: Add week view
- 260424, **v0.0.1-alpha**: Import Claude-generated scaffolding for the project

## Run

### Download for Android

Download the latest version from [the releases](https://github.com/stetai/stedule/tags) and install it. 

You may need to allow installation from unknown sources.

Furthermore, you may need to disable Play Protect in the Play Store, as the scanning prompt might bug and prevent the installation from finishing or cancelling.

### Try it out on localhost

Run the following line in a terminal from this folder (stedule/).
```
python -m http.server 8080
```

And navigate to http://localhost:8080 on the browser of your choice.
Click on "Open .ics file" to open your calendar. 

Updating the calendar (by editing or adding an event) will write the changes to the same file on a Chromium Browser.
On Firefox Browsers, a download will be triggered, allowing you to replace the original file with the new downloaded file.

### Linux, Windows Build

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