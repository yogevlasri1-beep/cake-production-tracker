#!/usr/bin/env ruby
# בודק שכל הקבצים שה-Service Worker מטמון קיימים

ROOT = File.expand_path('..', __dir__)
SW = File.join(ROOT, 'sw.js')

unless File.file?(SW)
  warn '❌ sw.js לא נמצא'
  exit 1
end

sw = File.read(SW)
block = sw[/const PRECACHE = \[([\s\S]*?)\];/m, 1] || ''
paths = block.scan(/v\?\(\s*['"](\.\/[^'"]+)['"]\s*\)|['"](\.\/[^'"]+)['"]/)
  .map { |a, b| a || b }
  .reject { |p| p.end_with?('/') }
  .map { |p| p.sub(%r{^\./}, '') }
  .uniq

missing = paths.reject { |p| File.file?(File.join(ROOT, p)) }

if missing.any?
  warn '❌ קבצים חסרים ל-offline:'
  missing.each { |p| warn "   #{p}" }
  exit 1
end

puts "✅ #{paths.length} קבצים מוכנים ל-offline"
