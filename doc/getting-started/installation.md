# Installation

## Goal

Install the released Zotero Evidence plugin in Zotero.

## Prerequisites

- Zotero 7, 8, 9, or 10. The currently documented release metadata accepts
  Zotero versions from 7 through 10.9.9. Check the release notes and metadata
  for the version you download, because compatibility can change in a later
  release.
- Permission to install a plugin in your Zotero application.

## Steps

1. Open the
   [latest Zotero Evidence release](https://github.com/etShaw-zh/zotero-evidence/releases/latest).
2. Download the release asset whose filename ends in `.xpi`. Do not extract it.
3. In Zotero, choose **Tools → Plugins**.
4. Drag the downloaded `.xpi` file onto the Plugins window and approve the
   installation if Zotero asks.
5. Restart Zotero if prompted. Open the **File** menu and check for the
   **Evidence Project** and **AI Settings** groups.

## Expected result

Zotero Evidence appears in **Tools → Plugins**, and its commands appear in
Zotero's **File** menu.

## Notes and limitations

- Install only an `.xpi` obtained from a release you trust. Zotero plugins have
  access to Zotero and to files available to the application.
- To upgrade manually, download the newer release `.xpi` and repeat the
  installation steps. Keep a recent project archive before upgrading important
  research workflows.
- To uninstall, open **Tools → Plugins**, locate Zotero Evidence, and use the
  remove action offered there. Uninstalling the plugin is not a substitute for
  deleting or archiving a project; archive any project you may need first.
- Source-code setup is for contributors, not end users. See the
  [contribution guide](https://github.com/etShaw-zh/zotero-evidence/blob/main/CONTRIBUTING.md)
  for the development profile, environment variables, and commands.

## Related pages

- [Configure an AI provider](ai-provider-setup.md)
- [Create your first project](first-project.md)
- [Troubleshooting](../troubleshooting.md)
