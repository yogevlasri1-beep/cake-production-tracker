require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'BackupFolder'
  s.version = package['version']
  s.summary = 'Backup folder picker for iOS Files app'
  s.license = 'MIT'
  s.homepage = 'https://github.com/yitzur/backup-folder'
  s.author = 'yitzur'
  s.source = { :git => 'https://github.com/yitzur/backup-folder', :tag => s.version.to_s }
  s.source_files = 'ios/Plugin/**/*.{swift,h,m,c,cc,mm,cpp}'
  s.ios.deployment_target = '14.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'
end
