#!/usr/bin/env python3
"""Install the early loader only into the owned development checkout."""
from pathlib import Path
import re
root = Path(__file__).resolve().parent
layout = root / 'canvas-lms/app/views/layouts/application.html.erb'
source = layout.read_text()
source = re.sub(r'<% if Rails\.env\.development\? %>\s*(?:<% content_for :head do %>\s*)?<!-- canvasdoc development loader -->.*?<% end %>\s*(?:<% end %>\s*)?', '', source, flags=re.S)
# Canvas supplies its head through a partial and named content block.
loader = '''<% if Rails.env.development? %>
<% content_for :head do %>
<!-- canvasdoc development loader -->
<link rel="stylesheet" href="/canvasdoc/bootstrap.css">
<script src="/canvasdoc/bootstrap.js"></script>
<script src="/canvasdoc/canvasdoc.js?v=<%= File.mtime(Rails.root.join('public/canvasdoc/canvasdoc.js')).to_i %>" async></script>
<% end %>
<% end %>
'''
head_marker = '<%= render :partial => "layouts/head" %>'
if head_marker not in source:
    raise SystemExit('Canvas layout changed; loader not installed.')
layout.write_text(source.replace(head_marker, loader + head_marker, 1))
print('Early development Canvasdoc loader installed.')
