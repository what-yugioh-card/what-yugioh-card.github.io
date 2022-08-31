(()=>
{

document.body.className = 'loading';

window.sleep = ((ms) => new Promise((r) => setTimeout(r, ms)));

const IMAGE_DB = (() =>
{
    let _imageDB = null;
    let _progress = [0,0];
    
    let _donePromise = (async () =>
    {
        const resp = await fetch('https://yugioh-deckcheck.github.io/neuron/imagedb.json');
        _progress[1] = +(resp.headers.get('content-length') || 0);
        const reader = resp.body.getReader();
        
        const decoder = new TextDecoder();
        let string = '';
        let chunk, done;
        while (!(({ value: chunk, done } = await reader.read()).done))
        {
            _progress[0] += chunk.length;
            string += decoder.decode(chunk);
        }
        
        _imageDB = JSON.parse(string);
        _progress[0] = _progress[1];
    })();
    
    return {
        GetProgress: (() => _progress),
        DonePromise: (() => _donePromise),
        GetResultSync: (() => _imageDB),
    };
})();

window.EnsureScriptLoaded = (() =>
{
    const _loadCache = {};
    return ((url) => (_loadCache[url] || (_loadCache[url] = new Promise((res, rej) =>
    {
        const e = document.createElement('script');
        e.src = url;
        e.addEventListener('load', res);
        e.addEventListener('error', rej);
        document.head.appendChild(e);
    }))));
})();

const {IsCurrent, SetCurrent} = (() =>
{
    let _current = null;
    return { IsCurrent: ((cur) => (cur == _current)), SetCurrent: (() => (_current = {})) };
})();

const {SetLoadingHeader, SetLoadingProgress, SetLoadingBarText, ResetLoading} = (() =>
{
    const _header = document.getElementById('loading-header');
    const _barFilled = document.getElementById('loading-bar-filled');
    const _barText = document.getElementById('loading-bar-text');
    
    return {
        SetLoadingHeader: ((h) => { _header.innerText = h; }),
        SetLoadingProgress: ((p) => { _barFilled.style.display = ''; _barFilled.style.width = (p ? ((p*100)+'%') : '1px'); }),
        SetLoadingBarText: ((t) => { _barText.innerText = t; }),
        ResetLoading: (() => { _header.innerText = ''; _barText.innerText = '', _barFilled.style.display = 'none'; }),
    };
})();

let ChooseInputScreen;
let LoadFromHash;
let LoadFromDataTransfer;
let LoadFromFile;
let LoadFromURL;
let Work;

ChooseInputScreen = (() =>
{
    let _t = null;
    document.body.addEventListener('dragover', (e) => { if (IsCurrent(_t)) e.preventDefault(); });
    document.body.addEventListener('drop', (e) => { if (!IsCurrent(_t)) return; e.preventDefault(); LoadFromDataTransfer(e.dataTransfer); });
    document.body.addEventListener('paste', (e) => { if (!IsCurrent(_t)) return; e.preventDefault(); LoadFromDataTransfer(e.clipboardData || window.clipboardData); });
    
    const dummyInput = document.createElement('input');
    dummyInput.type = 'file';
    dummyInput.accept = 'image/*';
    dummyInput.addEventListener('change', () => { if (!IsCurrent(_t)) return; LoadFromFile(dummyInput.files[0]); });
    document.getElementById('choose-box').addEventListener('click', () => { dummyInput.click(); });
    
    return (() =>
    {
        _t = SetCurrent();
        dummyInput.value = '';
        document.body.className = 'choose';
    });
})();

LoadFromHash = (() =>
{
    return (() =>
    {
        const hash = window.location.hash;
        if (hash && (hash.length > 1))
        try
        {
            const [type, data] = hash.substr(1).split(':');
            if ((type === 'uri') || (type === 'url'))
                return LoadFromURL(decodeURIComponent(data));
            else
                return LoadFromURL('data:image/'+type+';base64,'+data);
        } catch (e) {}
        return ChooseInputScreen();
    });
})();

LoadFromDataTransfer = (() => 
{
    return ((dt) =>
    {
        if (data.items) for (const item of data.items)
        {
            if (item.kind === 'file')
                return LoadFromFile(item.getAsFile());
        }

        if (data.files) for (const file of data.files)
            return LoadFromFile(file);
        
        const text = data.getData('text/plain');
        if (text)
        {
            try { LoadFromURL(new URL(text)); } catch (e) {}
        }
    });
})();

LoadFromFile = (() =>
{
    return ((file) =>
    {
        if (!file) return;
        return LoadFromURL(URL.createObjectURL(file), true);
    });
})();

LoadFromURL = (() =>
{
    const imgElm = document.createElement('img');
    let shouldRevokePrevious = false;
    return (async (url, shouldRevoke) =>
    {
        const throttle = sleep(100);
        const t = SetCurrent();
        ResetLoading();
        SetLoadingHeader('Loading Image');
        SetLoadingBarText('Waiting...');
        document.body.className = 'loading';
        
        if (shouldRevokePrevious)
            URL.revokeObjectURL(imgElm.src);
        imgElm.src = url;
        shouldRevokePrevious = shouldRevoke;
        
        SetLoadingBarText('Loading OpenCV...'),
        await EnsureScriptLoaded('js/imageparse.js');
        await EnsureScriptLoaded('https://yugioh-deckcheck.github.io/neuron/imagehash.js');
        await EnsureScriptLoaded('https://yugioh-deckcheck.github.io/neuron/cardident.js');
        if (!IsCurrent(t)) return;
        SetLoadingProgress(.1);
        
        await ImageParse.Ready();
        if (!IsCurrent(t)) return;
        SetLoadingProgress(.8);
        
        SetLoadingBarText('Loading image...');
        await imgElm.decode();
        if (!IsCurrent(t)) return;
        SetLoadingProgress(1);
        SetLoadingBarText('OK');
        
        await throttle;
        if (!IsCurrent(t)) return;
        
        const components = ImageParse.LoadImageGetComponents(imgElm);
        
        Work(components);
    });
})();

Work = (() =>
{
    document.getElementById('close-box').addEventListener('click', () => ChooseInputScreen());
    const _workStatusBox = document.getElementById('work-status-box');
    const _workStatusText = document.getElementById('work-status');
    const _overlayContainer = document.getElementById('overlay-container');
    
    const _tryRenderCard = ((card) =>
    {
        if (ImageParse.TryDrawCard(card))
        {
            const canvasWidth = ImageParse.GetCanvasWidth();
            const canvasHeight = ImageParse.GetCanvasHeight();
            const overlayBox = document.createElement('a');
            overlayBox.className = 'clickable-card';
            overlayBox.href = ('https://db.ygorganization.com/card#'+card.cardId);
            overlayBox.target = '_blank';
            overlayBox.style.left = ((card.left*100/canvasWidth)+'%');
            overlayBox.style.width = ((card.width*100/canvasWidth)+'%');
            overlayBox.style.top = ((card.top*100/canvasHeight)+'%');
            overlayBox.style.height = ((card.height*100/canvasHeight)+'%');
            _overlayContainer.appendChild(overlayBox);
            
            GetCardData(card.cardId).then((d) => { const name = (d.cardData.en || d.cardData.ja || { name: '???' }).name; overlayBox.title = name; console.log('Found',name,'confidence',card.scores.total.toFixed(2)+'%'); });
        }
    });
    
    return (async (components) =>
    {
        while (_overlayContainer.lastElementChild) _overlayContainer.removeChild(_overlayContainer.lastElementChild);
        
        const t = SetCurrent();
        ResetLoading();
        SetLoadingHeader('Loading Necessary Data');
        SetLoadingBarText('Waiting...');
        document.body.className = 'loading';
        let imageDB = null;
        while (!(imageDB = IMAGE_DB.GetResultSync()))
        {
            const [done, total] = IMAGE_DB.GetProgress();
            SetLoadingBarText(done+'/'+total);
            if (total)
                SetLoadingBarProgress(done/total);
            await Promise.race([sleep(100), IMAGE_DB.DonePromise()]);
            if (!IsCurrent(t)) return;
        }
        
        _workStatusBox.className = 'working';
        _workStatusText.innerText = 'Starting up…';
        document.body.className = 'working';
        
        _workStatusText.innerText = 'Finding cards…';
        await sleep(0);
        if (!IsCurrent(t)) return;
        
        let candidates = ImageParse.ComponentsToScoredCandidates(components);
        if (!candidates.length)
            candidates = [{left: 0, top: 0, width: ImageParse.GetCanvasWidth(), height: ImageParse.GetCanvasHeight()}];
        const nCandidates = candidates.length;
        _workStatusText.innerText = ('Found '+nCandidates+'…');
        
        await EnsureScriptLoaded('https://yugioh-deckcheck.github.io/carddata.js');
        
        let maybeCards = [];
        const STRIDE = 10;
        for (let i=0; i<nCandidates; i += STRIDE)
        {
            _workStatusText.innerText = ('Analyzed '+i+' of '+nCandidates+'…');
            await sleep(0);
            if (!IsCurrent(t)) return;
            
            const cards = candidates.slice(i, i+STRIDE)
                                    .map((c) => ImageParse.TryDetectCard(imageDB, c))
                                    .filter((o)=>(o));
            for (const card of cards)
            {
                if (card.scores.total > 85)
                    _tryRenderCard(card);
                else
                    maybeCards.push(card);
            }
        }
        
        for (const card of maybeCards.sort((a,b) => (b.scores.total - a.scores.total)))
            _tryRenderCard(card);
            
        _workStatusBox.className = '';
        _workStatusText.innerText = 'Done.';
    });
})();

LoadFromHash();
window.addEventListener('hashchange', LoadFromHash);

})();