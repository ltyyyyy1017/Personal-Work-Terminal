import { pad2, toDateStr } from "./date";

export interface ParsedEvent {
  title: string;
  start: string;
  end?: string;
  allDay: boolean;
  location?: string;
  tags: string[];
  description?: string;
  matched: string[];
  confidence: number;
}

const CN_DIGIT: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function cnToNumber(input: string): number | null {
  if (/^\d+$/.test(input)) return Number(input);
  if (input === "十") return 10;
  if (input.startsWith("十")) return 10 + (CN_DIGIT[input[1]] ?? 0);
  if (input.length === 2 && input[1] === "十") return (CN_DIGIT[input[0]] ?? 0) * 10;
  if (input.length === 3 && input[1] === "十") return (CN_DIGIT[input[0]] ?? 0) * 10 + (CN_DIGIT[input[2]] ?? 0);
  return CN_DIGIT[input] ?? null;
}

function normalize(input: string): string {
  return input
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ":")
    .replace(/[－—–~～]/g, "-")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[ \t\u3000]+/g, " ")
    .trim();
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60000);
}

/**
 * 中文自然语言 → 日历事件
 * 支持：明天下午3点 / 5月20日 09:00-11:00 / 下周三晚上7点半 / 6月1日全天 / 在行政楼302
 */
export function parseNaturalEvent(rawInput: string, now = new Date()): ParsedEvent {
  const original = normalize(rawInput);
  let s = original;
  const matched: string[] = [];
  const take = (m: RegExpMatchArray | null, keep = false): string => {
    if (!m) return "";
    matched.push(m[0].trim());
    if (!keep) s = s.replace(m[0], " ");
    return m[0];
  };

  /* tags */
  const tags: string[] = [];
  const tagRegex = /#([^\s#，,。；;]+)/g;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRegex.exec(s))) {
    tags.push(tagMatch[1]);
  }
  s = s.replace(tagRegex, " ");
  const deptMatch = s.match(/\[(行政部|运营部|个人)\]/);
  if (deptMatch) {
    tags.push(deptMatch[1]);
    s = s.replace(deptMatch[0], " ");
    matched.push(deptMatch[0]);
  }

  /* 全天 */
  let allDay = false;
  const allDayMatch = s.match(/全天|整天|一整天/);
  if (allDayMatch) {
    allDay = true;
    take(allDayMatch);
  }

  /* 日期 */
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let date: Date | null = null;

  const ymd = s.match(/(\d{4})\s*[年.\-/]\s*(\d{1,2})\s*[月.\-/]\s*(\d{1,2})\s*[日号]?/);
  const md = s.match(/(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
  const slash = s.match(/(?<!\d)(\d{1,2})\s*[/.]\s*(\d{1,2})(?!\d)/);

  if (ymd) {
    take(ymd);
    date = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  } else if (md) {
    take(md);
    const y = now.getFullYear();
    date = new Date(y, Number(md[1]) - 1, Number(md[2]));
    if (date.getTime() < today.getTime() - 180 * 86400_000) {
      date = new Date(y + 1, Number(md[1]) - 1, Number(md[2]));
    }
  } else if (slash) {
    take(slash);
    const y = now.getFullYear();
    date = new Date(y, Number(slash[1]) - 1, Number(slash[2]));
    if (date.getTime() < today.getTime() - 180 * 86400_000) {
      date = new Date(y + 1, Number(slash[1]) - 1, Number(slash[2]));
    }
  }

  if (!date) {
    const rel = s.match(/今天|今日|今晚|明天|明日|明晚|后天|大后天|昨天/);
    if (rel) {
      take(rel);
      const map: Record<string, number> = {
        今天: 0,
        今日: 0,
        今晚: 0,
        明天: 1,
        明日: 1,
        明晚: 1,
        后天: 2,
        大后天: 3,
        昨天: -1,
      };
      date = new Date(today);
      date.setDate(date.getDate() + map[rel[0]]);
    }
  }

  if (!date) {
    const wd = s.match(/(这|本|下|上)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/);
    if (wd) {
      take(wd);
      const idxMap: Record<string, number> = {
        一: 1,
        二: 2,
        三: 3,
        四: 4,
        五: 5,
        六: 6,
        日: 0,
        天: 0,
        "1": 1,
        "2": 2,
        "3": 3,
        "4": 4,
        "5": 5,
        "6": 6,
        "7": 0,
      };
      const target = idxMap[wd[2]];
      date = new Date(today);
      let delta = (target - today.getDay() + 7) % 7;
      if (wd[1] === "下") delta += 7;
      if (wd[1] === "上") delta -= 7;
      date.setDate(date.getDate() + delta);
    }
  }

  const dateKnown = Boolean(date);
  if (!date) date = new Date(today);

  /* 时间 */
  let startMinutes: number | null = null;
  let endMinutes: number | null = null;
  let durationMin: number | null = null;

  const period = s.match(/凌晨|早上|上午|中午|下午|傍晚|晚上|夜里/);
  const periodWord = period?.[0];

  const hourNum = "\\d{1,2}|十[一二]?|[一二三四五六七八九十]";
  const rangeRegex = new RegExp(
    `(${hourNum})\\s*(?:[:点]\\s*(\\d{1,2})?分?)?\\s*(?:-|到|至)\\s*(${hourNum})\\s*(?:[:点]\\s*(\\d{1,2})?分?)?`,
  );
  const range = s.match(rangeRegex);
  if (range && /[:点]/.test(range[0])) {
    const h1 = cnToNumber(range[1]);
    const m1 = range[2] ? Number(range[2]) : 0;
    const h2 = cnToNumber(range[3]);
    const m2 = range[4] ? Number(range[4]) : 0;
    if (h1 !== null && h2 !== null) {
      startMinutes = h1 * 60 + m1;
      endMinutes = h2 * 60 + m2;
      if (periodWord) {
        startMinutes = applyPeriod(startMinutes, periodWord);
        endMinutes = applyPeriod(endMinutes, periodWord);
      }
      take(range);
    }
  }

  if (startMinutes === null) {
    const timeRegex = new RegExp(
      `(${hourNum})\\s*(?::\\s*(\\d{2})|点\\s*(半|(\\d{1,2})\\s*分?)?)`,
    );
    const time = s.match(timeRegex);
    if (time) {
      const h = cnToNumber(time[1]);
      if (h !== null) {
        let minutes = 0;
        if (time[2]) minutes = Number(time[2]);
        else if (time[3] === "半") minutes = 30;
        else if (time[4]) minutes = Number(time[4]);
        startMinutes = h * 60 + minutes;
        if (periodWord) startMinutes = applyPeriod(startMinutes, periodWord);
        take(time);
      }
    }
  }

  /* 时长 */
  const dur = s.match(/(?:时长|持续)?\s*(\d+(?:\.\d+)?)\s*个?\s*小时/);
  if (dur) {
    durationMin = Math.round(Number(dur[1]) * 60);
    take(dur);
  } else if (/半小时/.test(s)) {
    durationMin = 30;
    s = s.replace("半小时", " ");
  }
  const minDur = s.match(/(\d+)\s*分钟/);
  if (minDur && durationMin === null) {
    durationMin = Number(minDur[1]);
    take(minDur);
  }

  /* 地点 */
  let location: string | undefined;
  const locLabel = s.match(/(?:地点|地址|会议室)\s*[:：]\s*([^，,。；;]+)/);
  if (locLabel) {
    location = locLabel[1].trim();
    take(locLabel);
  } else {
    const loc = s.match(/(?:在|于|@)\s*([^，,。；;\s]{2,30})/);
    if (loc) {
      location = loc[1].trim();
      take(loc);
    }
  }

  /* 标题 */
  let title = s
    .replace(/\s+/g, " ")
    .replace(/^[\s，,。.、;；:：\-]+/, "")
    .replace(/[\s，,。.、;；:：\-]+$/, "")
    .replace(/^(安排|新增|添加|新建|记录|记一下|帮我|提醒我|请|约|开|日程|会议)\s*/, "")
    .trim();

  if (title.length < 2 && location) {
    title = location;
    location = undefined;
  }
  if (!title) title = "新日程";
  if (!tags.length) {
    for (const dept of ["行政部", "运营部"]) {
      if (original.includes(dept)) tags.push(dept);
    }
  }

  /* 组装 */
  const pad = (n: number) => pad2(n);
  if (startMinutes === null) {
    return {
      title,
      start: toDateStr(date),
      allDay: true,
      location,
      tags,
      matched,
      confidence: dateKnown ? 0.85 : 0.4,
    };
  }

  const startDate = new Date(date);
  startDate.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
  let endDate: Date | null = null;
  if (endMinutes !== null) {
    endDate = new Date(date);
    endDate.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);
    if (endDate <= startDate) endDate = addMinutes(endDate, 24 * 60);
  } else if (durationMin) {
    endDate = addMinutes(startDate, durationMin);
  } else {
    endDate = addMinutes(startDate, 60);
  }

  return {
    title,
    start: `${toDateStr(startDate)}T${pad(startDate.getHours())}:${pad(startDate.getMinutes())}`,
    end: `${toDateStr(endDate)}T${pad(endDate.getHours())}:${pad(endDate.getMinutes())}`,
    allDay: allDay && startMinutes === null,
    location,
    tags,
    matched,
    confidence: dateKnown ? 0.92 : 0.5,
  };
}

function applyPeriod(minutes: number, period: string): number {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  let hour = h;
  if (period === "下午" || period === "傍晚" || period === "晚上" || period === "夜里") {
    if (hour < 12) hour += 12;
  } else if (period === "中午") {
    if (hour < 11) hour += 12;
  } else if (period === "凌晨") {
    if (hour === 12) hour = 0;
  } else if (period === "早上" || period === "上午") {
    if (hour === 12) hour = 0;
  }
  return hour * 60 + m;
}

export function parseBatch(input: string, now = new Date()): ParsedEvent[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseNaturalEvent(line, now));
}
