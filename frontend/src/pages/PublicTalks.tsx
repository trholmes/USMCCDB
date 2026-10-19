import {
  Anchor,
  Badge,
  Button,
  Container,
  Group,
  Loader,
  MultiSelect,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { EventPublic, TalkPublic } from "../api/types";
import { useSession } from "../auth/SessionContext";
import SiteBanner from "../components/SiteBanner";
import { TALK_TYPES } from "../constants";
import { today } from "../dates";
import { safeUrl } from "../urls";

// Talks without a conference (seminars, colloquia, outreach) are listed
// together after the conferences, by venue.
const NO_EVENT = "none";

type TalkGroup = {
  key: string;
  event: EventPublic | null;
  talks: TalkPublic[];
  // Newest talk in the group; orders the groups and stands in for a
  // conference without dates.
  latest: string;
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// "12–16 May 2026" / "30 Jun – 2 Jul 2026" / "May 2026" style range from
// YYYY-MM-DD strings (no Date objects: these are calendar dates, and a
// timezone shift would move a conference by a day).
export const formatDateRange = (
  start: string | null,
  end: string | null,
): string => {
  const parse = (s: string | null) => {
    const m = s && /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    return m
      ? { y: m[1], mo: MONTHS[Number(m[2]) - 1], d: Number(m[3]) }
      : null;
  };
  const a = parse(start);
  const b = parse(end);
  if (!a && !b) return "";
  if (!a || !b || (a.y === b.y && a.mo === b.mo && a.d === b.d)) {
    const one = (a ?? b)!;
    return `${one.d} ${one.mo} ${one.y}`;
  }
  if (a.y === b.y && a.mo === b.mo) return `${a.d}–${b.d} ${a.mo} ${a.y}`;
  if (a.y === b.y) return `${a.d} ${a.mo} – ${b.d} ${b.mo} ${a.y}`;
  return `${a.d} ${a.mo} ${a.y} – ${b.d} ${b.mo} ${b.y}`;
};

// Glance's "Future / Past / Show all" tabs: a talk is upcoming when its date
// (or, undated, its conference's last day) is today or later.
type When = "upcoming" | "past" | "all";
const isUpcoming = (t: TalkPublic, now: string) => {
  const d = t.date ?? t.event?.end_date ?? t.event?.start_date;
  return d != null && d >= now;
};

const csvCell = (v: string | null | undefined) =>
  `"${(v ?? "").replace(/"/g, '""')}"`;

// Export what's on screen, Glance-style, for programme committees and
// reports.
const downloadCsv = (groups: TalkGroup[]) => {
  const header = [
    "date",
    "conference",
    "location",
    "title",
    "speaker",
    "institution",
    "working_group",
    "type",
    "invited",
    "venue",
    "url",
    "slides_url",
    "recording_url",
  ];
  const rows = groups.flatMap((g) =>
    g.talks.map((t) =>
      [
        t.date,
        g.event?.name,
        g.event?.location,
        t.title,
        t.speaker_name,
        t.speaker_institution,
        t.working_group,
        t.talk_type,
        t.is_invited ? "yes" : "no",
        t.venue,
        t.url,
        t.slides_url,
        t.recording_url,
      ]
        .map(csvCell)
        .join(","),
    ),
  );
  const blob = new Blob([[header.join(","), ...rows].join("\r\n")], {
    type: "text/csv",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `usmcc-talks-${today()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
};

function ExternalLink({ href, label }: { href: string | null; label: string }) {
  const url = safeUrl(href);
  if (!url) return null;
  return (
    <Anchor href={url} target="_blank" rel="noopener noreferrer" size="sm">
      {label} ↗
    </Anchor>
  );
}

function GroupHeading({ group }: { group: TalkGroup }) {
  const e = group.event;
  if (!e) {
    return (
      <div>
        <Title order={4}>Seminars, colloquia & outreach</Title>
        <Text size="sm" c="dimmed">
          Talks given outside a conference, at the host shown.
        </Text>
      </div>
    );
  }
  const url = safeUrl(e.url);
  const when = formatDateRange(e.start_date, e.end_date);
  const meta = [e.location, when].filter(Boolean).join(" · ");
  return (
    <div>
      <Title order={4}>
        {url ? (
          <Anchor href={url} target="_blank" rel="noopener noreferrer" inherit>
            {e.name}
          </Anchor>
        ) : (
          e.name
        )}
      </Title>
      {meta && (
        <Text size="sm" c="dimmed">
          {meta}
        </Text>
      )}
    </div>
  );
}

/**
 * The public talks page (issue #175): every assigned or given USMCC talk,
 * grouped by conference like Glance's "talks by conference" listing, with
 * no sign-in required. The data comes from GET /talks/public, which names
 * a speaker only with their public-listing consent, so this page needs no
 * filtering of its own. Rendered standalone for visitors and inside the
 * app shell for signed-in members (same route).
 */
export default function PublicTalksPage() {
  const { me } = useSession();
  const [talks, setTalks] = useState<TalkPublic[] | null>(null);
  const [q, setQ] = useState("");
  const [year, setYear] = useState<string | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [when, setWhen] = useState<When>("all");

  useEffect(() => {
    api
      .get<TalkPublic[]>("/talks/public")
      .then(setTalks)
      .catch(() => setTalks([]));
  }, []);

  const years = useMemo(() => {
    const seen = new Set<string>();
    for (const t of talks ?? []) if (t.date) seen.add(t.date.slice(0, 4));
    return [...seen].sort().reverse();
  }, [talks]);

  const groups = useMemo<TalkGroup[]>(() => {
    const needle = q.trim().toLowerCase();
    const now = today();
    const matches = (t: TalkPublic) =>
      (!needle ||
        [
          t.title,
          t.speaker_name ?? "",
          t.speaker_institution ?? "",
          t.working_group ?? "",
          t.event?.name ?? "",
          t.venue ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle)) &&
      (when === "all" || (when === "upcoming") === isUpcoming(t, now)) &&
      (!year || (t.date ?? "").startsWith(year)) &&
      (types.length === 0 || types.includes(t.talk_type));
    const byKey = new Map<string, TalkGroup>();
    for (const t of talks ?? []) {
      if (!matches(t)) continue;
      const key = t.event ? String(t.event.id) : NO_EVENT;
      let g = byKey.get(key);
      if (!g) {
        g = { key, event: t.event, talks: [], latest: "" };
        byKey.set(key, g);
      }
      g.talks.push(t);
      if (t.date && t.date > g.latest) g.latest = t.date;
    }
    const sortKey = (g: TalkGroup) => g.event?.start_date || g.latest;
    return [...byKey.values()].sort((a, b) => {
      // Conferences first (newest first), the no-conference group last.
      if (!a.event !== !b.event) return a.event ? -1 : 1;
      return sortKey(b).localeCompare(sortKey(a)) || a.key.localeCompare(b.key);
    });
  }, [talks, q, year, types, when]);

  const shown = groups.reduce((n, g) => n + g.talks.length, 0);

  const body = (
    <Stack gap="xl">
      <div>
        <Title order={3}>Talks & presentations</Title>
        <Text size="sm" c="dimmed">
          Conference talks, seminars and colloquia given by members of the US
          Muon Collider Collaboration, from the collaboration database.
        </Text>
      </div>

      <Group gap="xs">
        <SegmentedControl
          value={when}
          onChange={(v) => setWhen(v as When)}
          data={[
            { value: "upcoming", label: "Upcoming" },
            { value: "past", label: "Past" },
            { value: "all", label: "All" },
          ]}
        />
        <TextInput
          placeholder="Search title, speaker, institution or conference…"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          w={{ base: "100%", sm: 300 }}
        />
        <Select
          data={years}
          value={year}
          onChange={setYear}
          clearable
          placeholder="All years"
          w={{ base: "100%", sm: 140 }}
        />
        <MultiSelect
          data={TALK_TYPES}
          value={types}
          onChange={setTypes}
          clearable
          placeholder={types.length ? undefined : "All types"}
          w={{ base: "100%", sm: 200 }}
        />
        <Button
          variant="light"
          size="sm"
          disabled={shown === 0}
          onClick={() => downloadCsv(groups)}
        >
          Export CSV
        </Button>
      </Group>

      {talks === null ? (
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      ) : shown === 0 ? (
        <Text c="dimmed">No talks match.</Text>
      ) : (
        <>
          <Text size="xs" c="dimmed">
            {shown} talk{shown === 1 ? "" : "s"} in {groups.length} group
            {groups.length === 1 ? "" : "s"}
          </Text>
          {groups.map((g) => {
            const hasArea = g.talks.some((t) => t.working_group);
            return (
              <Stack key={g.key} gap="xs">
                <GroupHeading group={g} />
                <Table.ScrollContainer minWidth={760}>
                  <Table striped>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th w={110}>Date</Table.Th>
                        <Table.Th>Title</Table.Th>
                        <Table.Th>Speaker</Table.Th>
                        <Table.Th>Institution</Table.Th>
                        {!g.event && <Table.Th>Host</Table.Th>}
                        {hasArea && <Table.Th>Area</Table.Th>}
                        <Table.Th>Type</Table.Th>
                        <Table.Th>Links</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {g.talks.map((t) => (
                        <Table.Tr key={t.id}>
                          <Table.Td>{t.date ?? "—"}</Table.Td>
                          <Table.Td>
                            {safeUrl(t.url) ? (
                              <Anchor
                                href={safeUrl(t.url)!}
                                target="_blank"
                                rel="noopener noreferrer"
                                size="sm"
                              >
                                {t.title}
                              </Anchor>
                            ) : (
                              t.title
                            )}
                          </Table.Td>
                          <Table.Td>{t.speaker_name ?? "—"}</Table.Td>
                          <Table.Td>{t.speaker_institution ?? "—"}</Table.Td>
                          {!g.event && <Table.Td>{t.venue ?? "—"}</Table.Td>}
                          {hasArea && (
                            <Table.Td>{t.working_group ?? "—"}</Table.Td>
                          )}
                          <Table.Td>
                            {t.talk_type}
                            {t.is_invited && (
                              <Badge
                                ml={6}
                                size="xs"
                                variant="light"
                                color="grape"
                              >
                                invited
                              </Badge>
                            )}
                          </Table.Td>
                          <Table.Td>
                            <Group gap="sm" wrap="nowrap">
                              <ExternalLink
                                href={t.slides_url}
                                label="Slides"
                              />
                              <ExternalLink
                                href={t.recording_url}
                                label="Recording"
                              />
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </Stack>
            );
          })}
        </>
      )}
    </Stack>
  );

  // Signed-in members see the page inside the app shell; visitors get a
  // minimal header with the way in.
  if (me) return body;
  return (
    <Container size="lg" py="md">
      <Stack gap="md">
        <SiteBanner />
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Group wrap="nowrap" gap={10} style={{ minWidth: 0 }}>
            <img src="/usmcc-mark.png" alt="" height={32} width={32} />
            <div style={{ minWidth: 0 }}>
              <Title order={4} fz={{ base: "md", sm: "xl" }} lh={1.2}>
                US Muon Collider Collaboration
              </Title>
              <Text size="xs" c="dimmed">
                <Anchor href="https://muoncollider.us" inherit>
                  muoncollider.us
                </Anchor>
              </Text>
            </div>
          </Group>
          <Button
            component={Link}
            to="/login"
            variant="light"
            size="compact-sm"
            style={{ flexShrink: 0 }}
          >
            Member sign-in
          </Button>
        </Group>
        {body}
      </Stack>
    </Container>
  );
}
