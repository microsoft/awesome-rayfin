# Fabric User Manager: setup in a tenant

How to bring Fabric User Manager to a tenant. Written from a first real setup. What the app is and how it is built: [README](../README.md).

The app has no rights of its own. Everything it reads or changes happens with the signed-in person's own sign-in, so Entra and Fabric decide what each person may do. Setup therefore consists of five things: one app registration, a handful of build values, one deployment, one administrator consent, and naming the first app admin.

## What you need

| Thing | Why |
| --- | --- |
| A Fabric workspace on a running capacity | The Rayfin item (app, database, hosting) lives there |
| The right to register an app in Entra | For the app's own sign-in |
| An administrator who can grant consent for the tenant | Once, for the permissions marked below |
| Node.js and this repository | To build and deploy |

## 1. Register the app

In Entra, App registrations, New registration:

- Name: `Fabric User Manager`. Accounts in this organizational directory only.
- Platform: **Single-page application**. Redirect URI: the address the app is hosted at (known after the first deployment; add `http://localhost:5173` for local development).
- No client secret. No certificate.

Under API permissions, add these **delegated** permissions:

| API | Permission | Needs an administrator | Used for |
| --- | --- | --- | --- |
| Microsoft Graph | `GroupMember.Read.All` | Yes | Reading groups, owners and members |
| Microsoft Graph | `User.ReadBasic.All` | No | Looking people up |
| Microsoft Graph | `GroupMember.ReadWrite.All` | Yes | Adding and removing members |
| Microsoft Graph | `User.Read.All` | Yes | Telling a guest or a disabled account from an ordinary one |
| Power BI Service | `Tenant.Read.All` | Yes | Reading who an audience is shared with (works for Fabric administrators only) |

Four more are asked for at the moment they are used: `User.Read`, `Workspace.Read.All` and `Workspace.ReadWrite.All` (Power BI Service), `Mail.Send`. By default every person can consent to these for themselves, so they need not be listed.

**That changes with "Assignment required"** (step 4). Once sign-in to the app is limited to assigned people, nobody can consent for themselves any more, and Entra answers "administrator approval required" for every permission. Then list these four as well and include them in the admin consent. Seen in the first real setup.

Note the **Application (client) ID** and the **Directory (tenant) ID**.

## 2. Build values

Copy `.env.example` to `.env` and fill in the values, or pass them as environment variables to the build. All of them are IDs, none is a secret.

| Value | Meaning |
| --- | --- |
| `VITE_UM_CLIENT_ID` | The client ID from step 1 |
| `VITE_UM_ADMIN_USER_IDS` | Object IDs of the first app admins, separated by commas |
| `VITE_UM_ADMIN_GROUP_ID` | Alternatively: object ID of a security group whose members are app admins |
| `VITE_UM_WRITES` | `true` puts member changes, requests and role bindings into the build. They still stay off until an app admin switches them on |

A guest of the tenant counts with their **guest object ID in this tenant**, not with the ID from their home tenant. The Setup page shows the acting identity.

## 3. Deploy

In `rayfin/rayfin.yml`:

- `services.staticHosting.assetAccess: public` (or `protected`). Without it the front end is refused.
- `auth.password.enabled: false`. Only the Fabric sign-in remains.

Then, signed in with the Rayfin command line (`npx rayfin login`):

```bash
npx rayfin up --tenant <tenant id> --workspace-id <workspace id> --dry-run
```

Check that the dry run names the workspace and item you expect, then run it without `--dry-run`. Give the app an item of its own: deployed onto an existing Governance Hub item, it would no longer declare the Hub's other tables. The output ends with the hosting address. Add that address as redirect URI to the registration from step 1. The deployment also writes the address into `rayfin/rayfin.yml` as an allowed redirect; if the first sign-in is refused because of the redirect address, run the deployment once more.

Later front-end changes only need:

```bash
npx rayfin up staticapp deploy
```

## 4. Administrator consent

Open the registration in Entra, API permissions, and choose **Grant admin consent**. The app's Setup page links there and shows, per permission, whether the current browser tab holds it.

This grants the listed permissions to the app for everyone who signs in. It does not give anyone new rights: an owner can still only change their own groups, and a person without a workspace role still sees no workspace.

Decide at this point whether only named people may sign in to the app at all: in Entra, Enterprise applications, `Fabric User Manager`, Properties, **Assignment required**.

If you switch it on: assign the people first, then switch it on, and grant admin consent for all permissions the app uses, including the four from step 1 that are normally left to each person.

## 5. First use

1. Open the hosting address and sign in. You see four tabs: three about access, and the Power BI Guidelines.
2. Choose Connect. The first window asks for the basic sign-in only.
3. As app admin, open **Setup**. Check the status lines and the permissions list.
4. Open **Workspaces**. Allow reading workspaces and groups. Discovery lists what your sign-in can read.
5. Activate the groups people should manage, from the list or by object ID.
6. In Setup, switch on member changes, and binding changes if app admins should manage workspace roles from the app.

## Optional: creating groups from the app

App admins can create a new, empty security group in Setup. This is off by default and needs three deliberate steps:

1. Add the delegated Graph permission `Group.ReadWrite.All` to the registration and grant admin consent for it. Graph offers no narrower permission for creating a group. With it, the app can do with groups whatever the signed-in person may do in Entra. For an ordinary person that is little; for someone who holds a group administration role it is a lot.
2. Therefore set **Assignment required** on the enterprise application first, and assign only the people who should use the app.
3. In Setup, switch on "Creating new groups".

A new group has no members and opens nothing. Give it a workspace role, an audience or a model role, then activate it.

## Optional: tailoring the Power BI Guidelines

The fourth tab shows general best practices for Power BI. To make it yours, open **Setup**, Power BI Guidelines, **Open questionnaire**. Fifty optional questions in six groups cover naming, tables, calendar, columns, measures and reports. Answer what matters and choose **Save for everyone**. The answers are then filled into the guideline text for everybody who uses the app, and listed at the end of the tab.

- Needs no permission in Entra or Fabric and no switch. The answers are stored in the app's own settings table, with who saved them and when.
- They change what the guidelines say. They do not check or change any model or report.
- Like the app's other settings, they are stored where any signed-in person could change them. The app accepts only the choices it offers and bounded free text.
- If two admins edit at the same time, the second one is told and can load the other's answers or replace them.
- The questions are asked in the language of the interface. What is stored is the same in both languages, so a German and an English reader see the same convention.

## Guided steps for audiences and model roles

The app cannot share an audience or fill a model role itself. On the Audiences and RLS / OLS tabs it shows the steps and a link into Fabric, and records what an app admin confirms afterwards. Such an entry is marked as confirmed by an admin. For audiences a Fabric administrator can read the sharing again; what Fabric says then replaces the confirmation.

## What to check afterwards

| Check | Expected |
| --- | --- |
| Sign-in page | Only the Microsoft button |
| Sign-in as a guest of the tenant | Works. The sign-in window opens in the app's tenant |
| Setup, permissions | Everything granted that you consented to; the rest is offered with a button |
| A member change on a test group | One entry in the app's log and one in Entra's audit log, with the same person and time |
| Switches | Off until you switched them on |

## Known limits

- Who an audience is shared with can only be read by a Fabric administrator.
- Roles of a semantic model and their members cannot be read. They are recorded by an app admin.
- The app's own records (activated groups, requests, the log) are written from the browser. They help; they do not enforce. Entra and Fabric enforce.

## Rollback

The front end: deploy the previous build with `npx rayfin up staticapp deploy --skip-build` from a folder that holds it. The tables are additive and can stay. Consent can be withdrawn in Entra at any time; the app then falls back to offering the permission again.
