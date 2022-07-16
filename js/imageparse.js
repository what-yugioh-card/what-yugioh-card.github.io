window.ImageParse = (() =>
{
    const FindEdgeMask = ((input) =>
    {
        const hsvImage = new cv.Mat();
        cv.cvtColor(input, hsvImage, cv.COLOR_RGB2HSV, 3);
        
        const lowerBound = new cv.Mat(hsvImage.rows, hsvImage.cols, hsvImage.type(), [108, 29, 49, 0]);
        const upperBound = new cv.Mat(hsvImage.rows, hsvImage.cols, hsvImage.type(), [158, 110, 165, 255]);
        const edge = cv.Mat.zeros(hsvImage.rows, hsvImage.cols, cv.CV_8U);
        cv.inRange(hsvImage, lowerBound, upperBound, edge);
        lowerBound.delete();
        upperBound.delete();
        hsvImage.delete();
        
        return edge;
    });
    
    const RefineEdgeMask = ((mask, epsX, epsY) =>
    {
        const ksize = new cv.Size(epsX, epsY);
        const elm = cv.getStructuringElement(cv.MORPH_RECT, ksize);
        const refinedMask = new cv.Mat();
        
        cv.morphologyEx(mask, refinedMask, cv.MORPH_OPEN, elm);
        
        elm.delete();
        
        return refinedMask;
    });
    
    const GetComponentsFromMask = ((mask) =>
    {
        const labels = new cv.Mat();
        const stats = new cv.Mat();
        const centroids = new cv.Mat();
        const num = cv.connectedComponentsWithStats(mask, labels, stats, centroids);
        const result = [];
        for (let i=1; i<num; ++i)
        {
            const left   = stats.intAt(i, cv.CC_STAT_LEFT);
            const top    = stats.intAt(i, cv.CC_STAT_TOP);
            const right  = left + stats.intAt(i, cv.CC_STAT_WIDTH);
            const bottom = top  + stats.intAt(i, cv.CC_STAT_HEIGHT);
            result.push({ left, right, top, bottom });
        }
        labels.delete();
        stats.delete();
        centroids.delete();
        return result;
    });
    
    const _imageCanvas = document.getElementById('the-image');
    const _highlightCanvas = document.getElementById('the-canvas');
    const _deduplicateCanvas = document.createElement('canvas');
    return {
        Ready: (() => EnsureScriptLoaded('js/dep/opencv-3.4.0.min.js')),
        LoadImageGetComponents: ((imgElm) => {
            const img = cv.imread(imgElm);
            
            const mask = FindEdgeMask(img);
            const betterMaskVertical = RefineEdgeMask(mask, 1, Math.max(15, Math.round(mask.rows*0.025)));
            const betterMaskHorizontal = RefineEdgeMask(mask, Math.max(10, Math.round(mask.cols*0.01)), 1);
            mask.delete();
            
            const componentsVertical = GetComponentsFromMask(betterMaskVertical);
            const componentsHorizontal = GetComponentsFromMask(betterMaskHorizontal);
            betterMaskHorizontal.delete();
            betterMaskVertical.delete();
            
            cv.imshow(_imageCanvas, img);
            _deduplicateCanvas.width = _highlightCanvas.width = _imageCanvas.width;
            _deduplicateCanvas.height = _highlightCanvas.height = _imageCanvas.height;
            img.delete();
            
            const hilitCtx = _highlightCanvas.getContext('2d');
            hilitCtx.fillStyle = 'rgba(0,0,0,0.6)';
            hilitCtx.fillRect(0, 0, _highlightCanvas.width, _highlightCanvas.height);
            
            const dedupCtx = _deduplicateCanvas.getContext('2d');
            dedupCtx.fillStyle = 'white';
            dedupCtx.fillRect(0, 0, _deduplicateCanvas.width, _deduplicateCanvas.height);
            
            return {componentsVertical, componentsHorizontal};
        }),
        ComponentsToScoredCandidates: (({componentsVertical, componentsHorizontal}) => {
            const xn=componentsVertical.length, yn=componentsHorizontal.length;
            const potentials = [];
            for (let x1=0; x1<xn; ++x1)
            {
                const componentV1 = componentsVertical[x1];
                for (let x2=(x1+1); x2<xn; ++x2)
                {
                    const componentV2 = componentsVertical[x2];
                    if ((componentV1.bottom < componentV2.top) || (componentV2.bottom < componentV1.top))
                        continue;
                    
                    const vTop = Math.min(componentV1.top, componentV2.top);
                    const vBottom = Math.max(componentV1.bottom, componentV2.bottom);
                    const vHeight = vBottom-vTop;
                    const left = Math.min(componentV1.left, componentV2.left);
                    const leftInner = Math.min(componentV1.right, componentV2.right);
                    const rightInner = Math.max(componentV1.left, componentV2.left);
                    const right = Math.max(componentV1.right, componentV2.right);
                    const width = right-left;
                    for (let y1=0; y1<yn; ++y1)
                    {
                        const componentH1 = componentsHorizontal[y1];
                        // no overlap with the area delimited by the vertical bars
                        if ((componentH1.right < leftInner) || (rightInner < componentH1.left))
                            continue;

                        for (let y2=(y1+1); y2<yn; ++y2)
                        {
                            const componentH2 = componentsHorizontal[y2];
                            
                            // no overlap with the area delimited by the vertical bars
                            if ((componentH2.right < left) || (right < componentH2.left))
                                continue;

                            // no overlap with the other horizontal bar
                            if ((componentH1.right < componentH2.left) || (componentH2.right < componentH1.left))
                                continue;
                            
                            const hLeft = Math.min(componentH1.left, componentH2.left);
                            const hRight = Math.max(componentH1.right, componentH2.right);
                            const hWidth = hRight-hLeft;
                            const top = Math.min(componentH1.top, componentH2.top);
                            const topInner = Math.min(componentH1.bottom, componentH2.bottom);
                            const bottomInner = Math.max(componentH1.top, componentH2.top);
                            const bottom = Math.max(componentH1.bottom, componentH2.bottom);
                            const height = bottom-top;
                            
                            // vertical bars should also be in the area delimited by the horizontal bars
                            if ((bottomInner < componentV1.top) || (componentV1.bottom < topInner))
                                continue;
                            if ((bottomInner < componentV2.top) || (componentV2.bottom < topInner))
                                continue;
                            
                            // aspect ratio heuristic (should be at least 1:1, at most 1:2)
                            const aspectRatio = height/width;
                            if ((aspectRatio < 1) || (aspectRatio > 2))
                                continue;
                            
                            const coverage = Math.min(hWidth/width, vHeight/height);
                            // coverage heuristic
                            if (coverage < 0.5)
                                continue;
                            
                            potentials.push({left, top, width, height, coverage});
                        }
                    }
                }
            }
            return potentials.sort((a,b) => (b.coverage - a.coverage));
        }),
        GetCanvasWidth: (() => _imageCanvas.width),
        GetCanvasHeight: (() => _imageCanvas.height),
        TryDetectCard: ((imagedb, {left, top, width, height}) =>
        {
            const fingerprint = CardFingerprint.Fingerprint(_imageCanvas, left, top, width, height);
            const scores = imagedb.map(([cardId,artId,thisFingerprint]) => {
                            const scores = CardFingerprint.Compare(fingerprint, thisFingerprint);
                            if (scores.total > 65)
                                return {cardId, artId, scores}
                        })
                        .filter((o)=>(o))
                        .sort((a,b) => (b.scores.total - a.scores.total));
            
            if (!scores.length)
                return null;
            GetCardData(scores[0].cardId);
            GetArtwork(scores[0].cardId, scores[0].artId);
            return Object.assign(scores[0], {left, top, width, height});
        }),
        TryDrawCard: (({cardId, artId, scores, left, top, width, height}) =>
        {
            const testCtx = _deduplicateCanvas.getContext('2d');
            if (!testCtx.getImageData(left, top, width, height).data.every((v) => (v == 255)))
                return false;
            testCtx.fillStyle = 'black';
            testCtx.fillRect(left, top, width, height);
            
            GetArtwork(cardId, artId).then((artwork) => { _highlightCanvas.getContext('2d').drawImage(artwork, left, top, width, height); });
            return true;
        }),
    };
})();