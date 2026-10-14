# v4.6.1

## Drive attachments in the scratchpad

### 📎 `attach` with source `drive` now fetches the file

`manage_scratchpad attach` accepted a Drive file ID but never downloaded anything, so a Drive attachment could not reach an email or a workspace file. Attach now downloads the file into the workspace when you attach it, and every send target treats it like any other workspace file:

```
manage_scratchpad { operation: 'attach', scratchpadId: 'sp-…', source: 'drive', fileId: '1AbC…', email: 'you@example.com' }
```

`email` is new and required for Drive attachments: it names the account that can read the file. Google Docs, Sheets and Slides have no bytes to download, so they are refused with a pointer to `manage_drive export`; export into the workspace, then attach with source `workspace`.

### Also

- **Sending to `workspace` reports attachments it could not copy.** It used to skip them silently. Each attachment is copied only from and to paths inside the workspace.
- **`manage_drive download` and `import drive_file` share the attach download path.** A Drive name containing `/` is now saved as one file in the workspace root rather than as nested folders; pass `outputPath` to choose subfolders yourself. `import drive_file` points binary files at `attach` instead of a two-step download.

Thank you to the ToFu research project at Penn State for the report that led to this release.
