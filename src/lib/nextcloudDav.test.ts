import { describe, expect, it } from "vitest";
import {
  buildSearchXml,
  cleanFolder,
  davFileUrl,
  fileLink,
  folderView,
  mimeAllowed,
  parseMultistatus,
  previewKind,
  sortEntries,
} from "./nextcloudDav";

const BASE = "https://cloud.example.com";

// Shaped like a real Nextcloud 33 PROPFIND answer: the folder itself first,
// a second propstat listing the props a folder does not have as 404.
const PROPFIND = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:response><d:href>/remote.php/dav/files/jonas/Finanzen/</d:href><d:propstat><d:prop><d:getlastmodified>Wed, 23 Sep 2026 15:06:48 GMT</d:getlastmodified><oc:fileid>453</oc:fileid><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat><d:propstat><d:prop><d:getcontenttype/><d:getcontentlength/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response><d:response><d:href>/remote.php/dav/files/jonas/Finanzen/UBS/</d:href><d:propstat><d:prop><d:getlastmodified>Mon, 31 Aug 2020 16:58:04 GMT</d:getlastmodified><oc:fileid>140518</oc:fileid><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat><d:propstat><d:prop><d:getcontenttype/><d:getcontentlength/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response><d:response><d:href>/remote.php/dav/files/jonas/Finanzen/2026.08.13%20green%20Rechnung%20%26%20Beleg.pdf</d:href><d:propstat><d:prop><d:getcontenttype>application/pdf</d:getcontenttype><d:getcontentlength>237305</d:getcontentlength><d:getlastmodified>Sun, 20 Sep 2026 12:31:05 GMT</d:getlastmodified><oc:fileid>1421722</oc:fileid><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response><d:response><d:href>/remote.php/dav/files/jonas/Finanzen/Quittung.jpg</d:href><d:propstat><d:prop><d:getcontenttype>image/jpeg</d:getcontenttype><d:getcontentlength>1000</d:getcontentlength><d:getlastmodified>Tue, 22 Sep 2026 08:00:00 GMT</d:getlastmodified><oc:fileid>1421800</oc:fileid><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response><d:response><d:href>/remote.php/dav/files/jonas/Finanzen/Notizen.docx</d:href><d:propstat><d:prop><d:getcontenttype>application/vnd.openxmlformats-officedocument.wordprocessingml.document</d:getcontenttype><d:getcontentlength>50</d:getcontentlength><d:getlastmodified>Wed, 23 Sep 2026 08:00:00 GMT</d:getlastmodified><oc:fileid>1421900</oc:fileid><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;

describe("parseMultistatus", () => {
  const entries = parseMultistatus(PROPFIND, BASE, "jonas");
  const byName = (n: string) => entries.find((e) => e.name === n)!;

  it("reads folders and files with their Nextcloud file id", () => {
    expect(entries.map((e) => e.path)).toEqual([
      "/Finanzen",
      "/Finanzen/UBS",
      "/Finanzen/2026.08.13 green Rechnung & Beleg.pdf",
      "/Finanzen/Quittung.jpg",
      "/Finanzen/Notizen.docx",
    ]);
    expect(byName("UBS").is_dir).toBe(true);
    expect(byName("Quittung.jpg")).toMatchObject({ file_id: "1421800", mime: "image/jpeg", size: 1000, is_dir: false });
  });

  it("decodes names from the href, including a percent-encoded ampersand", () => {
    expect(byName("2026.08.13 green Rechnung & Beleg.pdf").file_id).toBe("1421722");
  });

  it("decodes an XML entity in the href, which some servers send instead of %26", () => {
    const xml = `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/remote.php/dav/files/jonas/A&amp;B.pdf</d:href><d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response></d:multistatus>`;
    expect(parseMultistatus(xml, BASE, "jonas")[0].name).toBe("A&B.pdf");
  });

  it("gives a folder no type even though its 404 propstat names one", () => {
    expect(byName("UBS").mime).toBeNull();
  });

  it("turns the HTTP date into ISO", () => {
    expect(byName("Quittung.jpg").modified).toBe("2026-09-22T08:00:00.000Z");
  });

  it("links to the permalink, which survives a rename", () => {
    expect(byName("Quittung.jpg").link_url).toBe(`${BASE}/f/1421800`);
  });

  it("drops entries outside the user's files", () => {
    const other = PROPFIND.replace(/files\/jonas\/Finanzen\/Quittung/, "files/anna/Quittung");
    expect(parseMultistatus(other, BASE, "jonas").some((e) => e.name === "Quittung.jpg")).toBe(false);
  });

  it("does not take a user whose name merely starts the same", () => {
    const other = PROPFIND.replace(/files\/jonas\/Finanzen\/Quittung/, "files/jonasx/Quittung");
    expect(parseMultistatus(other, BASE, "jonas").some((e) => e.name === "Quittung.jpg")).toBe(false);
  });
});

describe("fileLink", () => {
  it("falls back to the folder view when the server gave no id", () => {
    expect(fileLink(BASE, "/A B/c.pdf", null)).toBe(`${BASE}/apps/files/?dir=%2FA%20B&scrollto=c.pdf`);
  });
});

describe("folderView", () => {
  const entries = parseMultistatus(PROPFIND, BASE, "jonas");

  it("drops the folder itself, lists folders first, then files newest first", () => {
    expect(folderView(entries, "/Finanzen", "any").map((e) => e.name)).toEqual([
      "UBS",
      "Notizen.docx",
      "Quittung.jpg",
      "2026.08.13 green Rechnung & Beleg.pdf",
    ]);
  });

  it("hides files a receipt cannot be, but keeps folders to browse into", () => {
    expect(folderView(entries, "/Finanzen/", "receipt").map((e) => e.name)).toEqual([
      "UBS",
      "Quittung.jpg",
      "2026.08.13 green Rechnung & Beleg.pdf",
    ]);
  });
});

describe("sortEntries", () => {
  const entries = parseMultistatus(PROPFIND, BASE, "jonas").filter((e) => e.path !== "/Finanzen");

  it("turns the files around for oldest first but keeps folders on top", () => {
    expect(sortEntries(entries, "asc").map((e) => e.name)).toEqual([
      "UBS",
      "2026.08.13 green Rechnung & Beleg.pdf",
      "Quittung.jpg",
      "Notizen.docx",
    ]);
  });
});

describe("mimeAllowed", () => {
  it("accepts a bank CSV for a statement but not for a receipt", () => {
    expect(mimeAllowed("statement", "text/csv")).toBe(true);
    expect(mimeAllowed("receipt", "text/csv")).toBe(false);
  });

  it("ignores parameters and case", () => {
    expect(mimeAllowed("receipt", "Application/PDF; charset=binary")).toBe(true);
  });

  it("refuses an unknown type unless anything goes", () => {
    expect(mimeAllowed("receipt", null)).toBe(false);
    expect(mimeAllowed("any", null)).toBe(true);
  });
});

describe("buildSearchXml", () => {
  it("sorts newest first", () => {
    expect(buildSearchXml("jonas", "x", "any", 25)).toMatch(
      /<d:orderby>\s*<d:order><d:prop><d:getlastmodified\/><\/d:prop><d:descending\/>/,
    );
  });

  it("asks the server for the oldest matches when sorting ascending", () => {
    const xml = buildSearchXml("jonas", "x", "any", 25, "asc");
    expect(xml).toContain("<d:getlastmodified/></d:prop><d:ascending/>");
    expect(xml).not.toContain("<d:descending/>");
  });

  it("filters by type on the server for receipts", () => {
    const xml = buildSearchXml("jonas", "x", "receipt", 25);
    expect(xml).toContain("<d:literal>application/pdf</d:literal>");
    expect(xml).toContain("<d:literal>image/%</d:literal>");
    expect(xml).not.toContain("text/csv");
  });

  it("keeps folders out when there is no type filter", () => {
    expect(buildSearchXml("jonas", "x", "any", 25)).toContain("<d:not><d:is-collection/></d:not>");
  });

  // Verified against Nextcloud 33: "F19%Nr" unescaped matched Rechnung_F19_Nr.pdf.
  it("treats % and _ in the query as literal characters", () => {
    expect(buildSearchXml("jonas", "F19%N_r", "any", 25)).toContain("<d:literal>%F19\\%N\\_r%</d:literal>");
  });

  it("escapes XML in the query and the user name", () => {
    const xml = buildSearchXml("a&b", "<x>", "any", 25);
    expect(xml).toContain("<d:href>/files/a&amp;b</d:href>");
    expect(xml).toContain("%&lt;x&gt;%");
  });
});

describe("paths", () => {
  it("encodes each segment of a WebDAV URL", () => {
    expect(davFileUrl(BASE, "jonas m", "/A B/#1.pdf")).toBe(
      `${BASE}/remote.php/dav/files/jonas%20m/A%20B/%231.pdf`,
    );
  });

  it("refuses to climb out of the user's files", () => {
    expect(cleanFolder("/a/../../etc/./x/")).toBe("/a/etc/x");
    expect(cleanFolder("")).toBe("/");
  });
});

describe("previewKind", () => {
  it("previews PDFs and the image types every browser decodes", () => {
    expect(previewKind("application/pdf")).toBe("pdf");
    expect(previewKind("image/jpeg")).toBe("image");
    expect(previewKind("Image/PNG; q=1")).toBe("image");
  });

  it("offers no preview for iPhone HEIC, SVG or unknown types", () => {
    expect(previewKind("image/heic")).toBeNull();
    expect(previewKind("image/svg+xml")).toBeNull();
    expect(previewKind(null)).toBeNull();
  });
});
