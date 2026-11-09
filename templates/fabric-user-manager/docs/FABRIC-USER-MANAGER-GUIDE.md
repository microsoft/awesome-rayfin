# Fabric User Manager: guide for owners and requesters

For people who use the app day to day. Setting it up is described in [the setup guide](FABRIC-USER-MANAGER-SETUP.md).

## The idea in one minute

Access in Fabric is given to **groups**, not to single people:

**Person → group → workspace role, app audience, or model role**

The app shows the groups you may manage or request, and what each group opens. Adding a person to a group gives that person everything the group opens. Removing them takes it away again.

The app has no rights of its own. Everything you do happens with your own sign-in, so you can only do what Entra and Fabric allow you to do anyway.

## The tabs

Three tabs are about access:

| Tab | Shows groups that open |
| --- | --- |
| **Workspaces** | a role in a workspace: Viewer, Contributor, Member or Admin |
| **Audiences** | an audience of an Org App |
| **RLS / OLS** | a role inside a semantic model, for example "only the rows of one region" |

Each tab has two lists: **Groups you manage** (you are an owner of the group) and **Available groups** (groups that are open for requests).

A fourth tab, **Power BI Guidelines**, is a reference. It grants nothing and blocks nothing; a request for access only states that you have read it. It holds best practices for building semantic models and reports: data integration, data modeling and data visualization, with the Tabular Style Guide as part of data modeling, and drawings that show the rules. Inside a topic the most important rule comes first. You can search it. Where your organization has recorded its own conventions, for example the casing of names or the name of the measure table, they are filled into the text and marked. An app admin records them in **Setup**, under Power BI Guidelines. The guide exists in English and German and follows the language of the interface.

## First time

1. Open the app and sign in with your Microsoft account.
2. Choose **Connect**. A Microsoft window asks whether the app may sign you in and read your profile. This is asked once.
3. Later, some functions ask for one more permission at the moment you use them, for example when you first add a person. Each window names exactly what is asked for.

If a window says that an administrator has to approve, the app tells you so. Ask your app admin.

## What a group opens

Every group shows what it opens. Read the small marks next to it:

| Mark | Meaning |
| --- | --- |
| no mark | Read from Fabric. This is a fact |
| **derived, not stated by Fabric** | Worked out from who can open the audience. Usually right, not guaranteed |
| **recorded, not verified** | An admin wrote it down, because the app cannot read it. Treat it as a note |
| **App admins only** | The group carries the workspace role Member or Admin. Only app admins change it here, and it cannot be requested |

## If you own a group

**See who is in it.** Choose **Show members**. The list is read live from Entra. **Export members** gives you the list as an Excel file.

**Add people.**

1. Choose **Add people**.
2. Enter one or more people, one per line, as sign-in name (name@company.com) or object ID. Up to 100 at once.
3. Optionally set **Review by**: a date on which you want to look at this membership again.
4. Choose **Check**. The app looks each person up and shows what they will get. People who are already members, guests and disabled accounts are marked.
5. Choose **Add now**.

**Remove a person.** In the member list, choose remove next to the person. The app shows what this person loses through this group. Other paths, for example through another group, may remain. Confirm with **Remove now**.

**Find a person.** **Look up a person** in the header shows in which of your groups a person is a direct member.

After a change the app reads the group again and tells you "confirmed" or "accepted, not yet visible". It can take a few minutes until Fabric lets the person in.

## If you need access

1. Open the tab that fits and look under **Available groups**.
2. Read what the group opens. Choose **Request access**.
3. Say **why you need this access**, in at least a few words. Optionally suggest a review date.
4. Choose **Send request**. By sending you confirm that you have read the **Power BI Guidelines**; the form says so and links them, and they open in a tab of their own. The owners see your request in the app. If you allow it, they also get a mail sent from your own mailbox.

You can **Withdraw** a request as long as nobody has decided it.

## If someone requests your group

A number on the tab shows waiting requests. Under **Requests waiting for a decision** you see who asked, when and why.

- **Approve and add** adds the person to the group with your own sign-in.
- **Deny** closes the request. You can add a short note.

You cannot decide your own request. If the app warns that the directory names a different person than the request, deny it.

If the group has changed since the request was made (it now opens something else), the app asks you to deny it and have the person request again, so nobody approves something they did not see.

## What the app does not do

- It does not change what a group opens, unless you are an app admin.
- It does not show members of groups you do not own.
- It cannot read who is in a role of a semantic model. Those entries are notes.
- It never acts in the background. Nothing happens unless you click.

## When something looks wrong

| You see | What it means |
| --- | --- |
| "could not be read" | Entra or Fabric did not answer, or you lack the right. Nothing is shown rather than something incomplete |
| "No clear answer" after a change | Do not try again at once. Refresh; the app shows what is true now |
| A group is missing | It is not activated in the app, or you are not its owner. Ask your app admin |
| The app stays on "loading" | Reload the page. After long pauses the first load can take a while |
