#import <Capacitor/Capacitor.h>

CAP_PLUGIN(BackupFolderPlugin, "BackupFolder",
    CAP_PLUGIN_METHOD(pickFolder, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(writeFile, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(readFile, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(readdir, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(deleteFile, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(clearFolder, CAPPluginReturnPromise);
)
