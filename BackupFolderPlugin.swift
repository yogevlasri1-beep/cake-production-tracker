import Foundation
import Capacitor

@objc(BackupFolderPlugin)
public class BackupFolderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BackupFolderPlugin"
    public let jsName = "BackupFolder"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickFolder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readdir", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearFolder", returnType: CAPPluginReturnPromise),
    ]

    private let bookmarkKey = "yitzur_backup_folder_bookmark"
    private var pendingCall: CAPPluginCall?

    @objc func pickFolder(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
            picker.delegate = self
            picker.allowsMultipleSelection = false
            self.pendingCall = call
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    @objc func writeFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), let data = call.getString("data") else {
            call.reject("Missing path or data")
            return
        }
        guard let url = resolveFolderURL() else {
            call.reject("No backup folder selected")
            return
        }
        guard url.startAccessingSecurityScopedResource() else {
            call.reject("Cannot access folder")
            return
        }
        defer { url.stopAccessingSecurityScopedResource() }
        let fileURL = url.appendingPathComponent(path)
        do {
            try data.write(to: fileURL, atomically: true, encoding: .utf8)
            call.resolve()
        } catch {
            call.reject("Write failed: \(error.localizedDescription)")
        }
    }

    @objc func readFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("Missing path")
            return
        }
        guard let url = resolveFolderURL() else {
            call.reject("No backup folder selected")
            return
        }
        guard url.startAccessingSecurityScopedResource() else {
            call.reject("Cannot access folder")
            return
        }
        defer { url.stopAccessingSecurityScopedResource() }
        do {
            let text = try String(contentsOf: url.appendingPathComponent(path), encoding: .utf8)
            call.resolve(["data": text])
        } catch {
            call.reject("Read failed: \(error.localizedDescription)")
        }
    }

    @objc func readdir(_ call: CAPPluginCall) {
        guard let url = resolveFolderURL() else {
            call.resolve(["entries": []])
            return
        }
        guard url.startAccessingSecurityScopedResource() else {
            call.reject("Cannot access folder")
            return
        }
        defer { url.stopAccessingSecurityScopedResource() }
        do {
            let items = try FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: [.isDirectoryKey, .fileSizeKey, .contentModificationDateKey])
            var entries: [[String: Any]] = []
            for item in items {
                if item.pathExtension.lowercased() != "json" { continue }
                let values = try item.resourceValues(forKeys: [.isDirectoryKey, .fileSizeKey, .contentModificationDateKey])
                if values.isDirectory == true { continue }
                entries.append([
                    "name": item.lastPathComponent,
                    "isDir": false,
                    "size": values.fileSize ?? 0,
                    "mtime": Int(values.contentModificationDate?.timeIntervalSince1970 ?? 0),
                ])
            }
            call.resolve(["entries": entries])
        } catch {
            call.reject("List failed: \(error.localizedDescription)")
        }
    }

    @objc func deleteFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("Missing path")
            return
        }
        guard let url = resolveFolderURL() else {
            call.reject("No backup folder selected")
            return
        }
        guard url.startAccessingSecurityScopedResource() else {
            call.reject("Cannot access folder")
            return
        }
        defer { url.stopAccessingSecurityScopedResource() }
        let fileURL = url.appendingPathComponent(path)
        do {
            if FileManager.default.fileExists(atPath: fileURL.path) {
                try FileManager.default.removeItem(at: fileURL)
            }
            call.resolve()
        } catch {
            call.reject("Delete failed: \(error.localizedDescription)")
        }
    }

    @objc func clearFolder(_ call: CAPPluginCall) {
        UserDefaults.standard.removeObject(forKey: bookmarkKey)
        call.resolve()
    }

    private func resolveFolderURL() -> URL? {
        guard let data = UserDefaults.standard.data(forKey: bookmarkKey) else { return nil }
        var stale = false
        return try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
    }

    private func saveBookmark(_ url: URL) {
        if let data = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
            UserDefaults.standard.set(data, forKey: bookmarkKey)
        }
    }
}

extension BackupFolderPlugin: UIDocumentPickerDelegate {
    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        guard let url = urls.first else {
            call.reject("No folder selected")
            return
        }
        guard url.startAccessingSecurityScopedResource() else {
            call.reject("Cannot access folder")
            return
        }
        saveBookmark(url)
        url.stopAccessingSecurityScopedResource()
        call.resolve(["folder": ["id": "ios", "name": url.lastPathComponent]])
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pendingCall?.reject("User cancelled", "CANCELLED")
        pendingCall = nil
    }
}
