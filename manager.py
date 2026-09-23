#!/usr/bin/env python3
import argparse, json, re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
from xml.sax.saxutils import escape

ROOT=Path(__file__).resolve().parent
DATA=ROOT/"data"/"stories.json"
FEED=ROOT/"feed.xml"
TZ=ZoneInfo("America/New_York")
WPM=150
MAX_PUBLISH_STORIES=5
INTRO="From Media Jobs Report, this is Media’s Morning Brief."
TRANSITIONS=["Next,", "Also,", "Meanwhile,", "In other news,"]
OUTROS=[
    "For more news, the latest jobs, media tools and more, log on to Media Jobs Report dot com.",
    "Stay up to date with more media news, the latest jobs, industry tools and more at Media Jobs Report dot com.",
    "Find more media news, new job opportunities, industry tools and more at Media Jobs Report dot com.",
    "For the latest media headlines, jobs, tools and more, visit Media Jobs Report dot com.",
]

def load():
    if DATA.exists():
        return json.loads(DATA.read_text(encoding="utf-8"))
    return {"timezone":"America/New_York","stories":[]}

def save(d):
    DATA.parent.mkdir(parents=True,exist_ok=True)
    DATA.write_text(json.dumps(d,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")

def wc(s): return len(re.findall(r"\b[\w’'-]+\b",s))
def seconds(s): return max(1,round(wc(s)/WPM*60))
def now(): return datetime.now(TZ)
def new_id(d):
    stamp=now().strftime("%Y%m%d")
    n=1
    existing={x["id"] for x in d["stories"]}
    while f"{stamp}-{n:02d}" in existing: n+=1
    return f"{stamp}-{n:02d}"

def add(d,text):
    text=" ".join(text.split())
    if not text: raise SystemExit("Story text is required.")
    t=now()
    d["stories"].append({"id":new_id(d),"date":t.strftime("%Y-%m-%d"),"created_at":t.isoformat(timespec="seconds"),"text":text,"words":wc(text),"seconds":seconds(text),"published":False})

def edit(d,sid,text):
    for x in d["stories"]:
        if x["id"]==sid:
            x["text"]=" ".join(text.split()); x["words"]=wc(x["text"]); x["seconds"]=seconds(x["text"]); return
    raise SystemExit("Story ID not found.")

def delete(d,sid):
    before=len(d["stories"]); d["stories"]=[x for x in d["stories"] if x["id"]!=sid]
    if len(d["stories"])==before: raise SystemExit("Story ID not found.")

def move(d,sid,direction):
    a=d["stories"]; i=next((i for i,x in enumerate(a) if x["id"]==sid),None)
    if i is None: raise SystemExit("Story ID not found.")
    j=i-1 if direction=="up" else i+1
    if 0<=j<len(a): a[i],a[j]=a[j],a[i]

def build_brief(selected, publish_date):
    parts=[INTRO]
    for i,x in enumerate(selected):
        text=x["text"].strip()
        if i==0:
            parts.append(text)
        elif i==len(selected)-1:
            parts.append("And finally, "+text)
        else:
            parts.append(TRANSITIONS[(i-1)%len(TRANSITIONS)]+" "+text)
    # Rotate the closing line by date so each published edition gets one stable outro.
    outro_index=int(publish_date.strftime("%Y%m%d")) % len(OUTROS)
    parts.append(OUTROS[outro_index])
    return "\n\n".join(parts)

def publish(d):
    pub=now()
    today=pub.strftime("%Y-%m-%d")
    selected=[x for x in d["stories"] if x["date"]==today]
    if not selected: raise SystemExit("No stories entered for today.")
    if len(selected)>MAX_PUBLISH_STORIES:
        raise SystemExit(f"Morning Brief is limited to {MAX_PUBLISH_STORIES} stories. Delete or move extras before publishing.")
    for x in selected: x["published"]=True
    full=build_brief(selected, pub)
    guid=f"mjr-morning-brief-{today}"
    iso=pub.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ")
    xml=f'''<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>Media’s Morning Brief</title>\n    <link>https://www.mediajobsreport.com/</link>\n    <description>Broadcast-ready Media Jobs Report Morning Brief audio scripts.</description>\n    <language>en-us</language>\n    <ttl>30</ttl>\n    <lastBuildDate>{iso}</lastBuildDate>\n    <item>\n      <title>Media’s Morning Brief — {pub.strftime("%B %d, %Y")}</title>\n      <guid isPermaLink="false">{guid}</guid>\n      <link>https://www.mediajobsreport.com/</link>\n      <pubDate>{iso}</pubDate>\n      <description>{escape(full)}</description>\n    </item>\n  </channel>\n</rss>\n'''
    FEED.write_text(xml,encoding="utf-8")

def main():
    p=argparse.ArgumentParser()
    p.add_argument("action",choices=["add","edit","delete","up","down","publish"])
    p.add_argument("--story",default="")
    p.add_argument("--id",default="")
    a=p.parse_args(); d=load()
    if a.action=="add": add(d,a.story)
    elif a.action=="edit": edit(d,a.id,a.story)
    elif a.action=="delete": delete(d,a.id)
    elif a.action in ("up","down"): move(d,a.id,a.action)
    elif a.action=="publish": publish(d)
    save(d)
    today=now().strftime("%Y-%m-%d")
    todays=[x for x in d["stories"] if x["date"]==today]
    print(f"{len(todays)} stories | {sum(x['words'] for x in todays)} words | about {sum(x['seconds'] for x in todays)//60}:{sum(x['seconds'] for x in todays)%60:02d}")

if __name__=="__main__": main()
