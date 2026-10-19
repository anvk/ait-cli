// Clones paths with clonefile(2), reading one "source\tdestination" pair per line
// from stdin. On APFS this shares the blocks copy-on-write, so cloning a directory
// tree is a single near-instant call that consumes no extra disk space, where a
// normal copy walks every file. lanes uses it to mirror a base folder's untracked
// content (node_modules and friends) into a new lane worktree.
//
// The destination must not already exist; lanes only clones paths that a freshly
// created worktree does not have. Any failure exits non-zero and lanes copies instead.
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/clonefile.h>

int main(void) {
  char line[8192];

  while (fgets(line, sizeof(line), stdin) != NULL) {
    size_t length = strlen(line);
    if (length > 0 && line[length - 1] == '\n') {
      line[--length] = '\0';
    }
    if (length == 0) {
      continue;
    }

    char *separator = strchr(line, '\t');
    if (separator == NULL) {
      fprintf(stderr, "clonedir: expected 'source<tab>destination'\n");
      return 2;
    }
    *separator = '\0';

    if (clonefile(line, separator + 1, 0) != 0) {
      fprintf(stderr, "clonedir: %s -> %s: %s\n", line, separator + 1, strerror(errno));
      return 1;
    }
  }

  return 0;
}
