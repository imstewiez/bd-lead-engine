@echo off
setlocal
cd /d %~dp0
if not exist data mkdir data

echo Starting focused max harvesters...
start "source-harvester-linkedin" /min cmd /c "node src/source-harvester.js --workerName=source-harvester-linkedin --onlyChannels=linkedin --queryOffsetBase=12000 --maxQueries=240 --limitPerQuery=15 --delayMs=4800 --fetchPages=true --deepEnrich=true --searchContacts=true --maxContactPages=8 --maxExternalWebsites=7 --maxTrailQueries=28 --trailLimit=10 --exportEvery=3 1>>data\source-harvester-linkedin.out.log 2>>data\source-harvester-linkedin.err.log"
start "source-harvester-instagram" /min cmd /c "node src/source-harvester.js --workerName=source-harvester-instagram --onlyChannels=instagram --queryOffsetBase=15000 --maxQueries=210 --limitPerQuery=15 --delayMs=5200 --fetchPages=true --deepEnrich=true --searchContacts=true --maxContactPages=8 --maxExternalWebsites=7 --maxTrailQueries=28 --trailLimit=10 --exportEvery=3 1>>data\source-harvester-instagram.out.log 2>>data\source-harvester-instagram.err.log"
start "source-harvester-platforms" /min cmd /c "node src/source-harvester.js --workerName=source-harvester-platforms --onlyChannels=myfxbook,mql5,specialist --queryOffsetBase=18000 --maxQueries=260 --limitPerQuery=15 --delayMs=5200 --fetchPages=true --deepEnrich=true --searchContacts=true --maxContactPages=8 --maxExternalWebsites=7 --maxTrailQueries=28 --trailLimit=10 --maxMql5QueryShare=1 --minMql5Queries=260 --exportEvery=3 1>>data\source-harvester-platforms.out.log 2>>data\source-harvester-platforms.err.log"
start "source-harvester-communities" /min cmd /c "node src/source-harvester.js --workerName=source-harvester-communities --onlyChannels=telegram,discord,forum,x,tiktok,facebook_threads --queryOffsetBase=21000 --maxQueries=240 --limitPerQuery=12 --delayMs=5500 --fetchPages=true --deepEnrich=true --searchContacts=true --maxContactPages=8 --maxExternalWebsites=7 --maxTrailQueries=28 --trailLimit=10 --exportEvery=3 1>>data\source-harvester-communities.out.log 2>>data\source-harvester-communities.err.log"
start "source-harvester-events" /min cmd /c "node src/source-harvester.js --workerName=source-harvester-events --onlyChannels=ecosystem,recruitment --queryOffsetBase=24000 --maxQueries=190 --limitPerQuery=12 --delayMs=6200 --fetchPages=true --deepEnrich=true --searchContacts=true --maxContactPages=8 --maxExternalWebsites=7 --maxTrailQueries=28 --trailLimit=10 --exportEvery=3 1>>data\source-harvester-events.out.log 2>>data\source-harvester-events.err.log"

echo Focused max harvesters started.
endlocal
