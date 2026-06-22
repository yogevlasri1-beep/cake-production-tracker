# frozen_string_literal: true
# encoding: ASCII-8BIT
# Generates app icons as PNG (blue rounded square with white chart bars)

require 'zlib'
require 'fileutils'

def crc32(data)
  Zlib.crc32(data)
end

def chunk(type, data)
  type = type.b
  data = data.b
  [data.bytesize].pack('N') + type + data + [crc32(type + data)].pack('N')
end

def write_png(path, size)
  raw = +''.b
  radius = (size * 0.22).to_i
  cx = cy = size / 2.0

  size.times do |y|
    raw << "\x00"
    size.times do |x|
      corner =
        (x < radius && y < radius && (x - radius)**2 + (y - radius)**2 > radius**2) ||
        (x >= size - radius && y < radius && (x - (size - radius - 1))**2 + (y - radius)**2 > radius**2) ||
        (x < radius && y >= size - radius && (x - radius)**2 + (y - (size - radius - 1))**2 > radius**2) ||
        (x >= size - radius && y >= size - radius &&
          (x - (size - radius - 1))**2 + (y - (size - radius - 1))**2 > radius**2)

      bar_w = (size * 0.11).to_i
      gap = (size * 0.06).to_i
      base_y = (size * 0.72).to_i
      bars = [
        [size * 0.28, base_y - (size * 0.18).to_i],
        [size * 0.42, base_y - (size * 0.32).to_i],
        [size * 0.56, base_y - (size * 0.24).to_i],
      ]

      on_bar = bars.any? do |bx, by|
        x >= bx.to_i && x < bx.to_i + bar_w && y >= by && y < base_y
      end

      if corner
        raw << [240, 244, 248].pack('C3')
      elsif on_bar
        raw << [255, 255, 255].pack('C3')
      else
        t = ((x + y).to_f / (size * 2))
        r = (29 + t * 8).to_i
        g = (78 + t * 10).to_i
        b = (216 + t * 20).to_i
        raw << [r, g, b].pack('C3')
      end
    end
  end

  ihdr = [size, size, 8, 2, 0, 0, 0].pack('NNCCCCC')
  compressed = Zlib::Deflate.deflate(raw, Zlib::BEST_COMPRESSION)
  png = +"\x89PNG\r\n\x1a\n".b +
        chunk('IHDR', ihdr) +
        chunk('IDAT', compressed) +
        chunk('IEND', ''.b)
  File.binwrite(path, png)
end

FileUtils.mkdir_p(File.join(__dir__, '..', 'icons'))
base = File.expand_path('../icons', __dir__)
{
  'apple-touch-icon.png' => 180,
  'icon-192.png' => 192,
  'icon-512.png' => 512
}.each { |name, px| write_png(File.join(base, name), px) }
puts "Icons written to #{base}"
