# AEGIS shared extractor prologue — prepended to every filesystem
# extractor's Python body by run_python_extractor (_shared_utils.sh).
#
# Provides: os, re, sys, json imports; `root` (argv[1], default '.');
# `prune_paths` (from PRUNE_PATHS env); and `all_files`, the pruned,
# repo-relative file inventory shared by all extractors.

import os
import re
import sys
import json

root = sys.argv[1] if len(sys.argv) > 1 else '.'
prune_paths = os.environ.get('PRUNE_PATHS', '').split()


def _is_pruned(rel_norm):
    return any(
        rel_norm == p or rel_norm.startswith(p + '/')
        for p in prune_paths
    )


all_files = []
for dirpath, dirnames, filenames in os.walk(root):
    try:
        rel_dir = os.path.relpath(dirpath, '.')
    except ValueError:
        rel_dir = ''
    if rel_dir == '.':
        rel_dir = ''

    i = len(dirnames) - 1
    while i >= 0:
        d_rel = os.path.join(rel_dir, dirnames[i]) if rel_dir else dirnames[i]
        if _is_pruned(d_rel.replace('\\', '/')):
            del dirnames[i]
        i -= 1

    for f in filenames:
        f_rel = os.path.join(rel_dir, f) if rel_dir else f
        f_rel_norm = f_rel.replace('\\', '/')
        if not _is_pruned(f_rel_norm):
            all_files.append(f_rel_norm)
