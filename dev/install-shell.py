#!/usr/bin/env python3
"""Install the early loader only into the owned development checkout."""
from pathlib import Path
import re
root = Path(__file__).resolve().parent
layout = root / 'canvas-lms/app/views/layouts/application.html.erb'
source = layout.read_text()
source = re.sub(
    r'<% if Rails\.env\.development\? %>\s*'
    r'(?:<% content_for :head do %>\s*)?'
    r'<!-- canvasdoc development loader -->.*?<% end %>\s*'
    r'(?:<% end %>\s*)?',
    '',
    source,
    flags=re.S,
)
loader = '''<% if Rails.env.development? %>
<!-- canvasdoc development loader -->
<link rel="stylesheet" href="/canvasdoc/bootstrap.css">
<script src="/canvasdoc/bootstrap.js"></script>
<script src="/canvasdoc/canvasdoc.js?v=<%= File.mtime(Rails.root.join('public/canvasdoc/canvasdoc.js')).to_i %>" async></script>
<% end %>
'''
head_marker = '<%= render :partial => "layouts/head" %>'
if head_marker not in source:
    raise SystemExit('Canvas layout changed; loader not installed.')
# Canvas supplies its head through a partial and named content block.
loader = loader.replace('<% if Rails.env.development? %>', '<% if Rails.env.development? %>\n<% content_for :head do %>').replace('<% end %>\n', '<% end %>\n<% end %>\n')
layout.write_text(source.replace(head_marker, loader + head_marker, 1))
print('Early development Canvasdoc loader installed.')
