import React, { useState, useEffect, useRef, useCallback } from 'react';

const PRESETS = [
  { id: 'post', name: 'POST', width: 1080, height: 1440 },
  { id: 'square', name: 'SQUARE', width: 1080, height: 1080 },
  { id: 'story', name: 'STORY', width: 1080, height: 1920 }
];

const MAX_IMAGES = 20;

export default function App() {
  const [images, setImages] = useState([]);
  const [preset, setPreset] = useState(PRESETS[0]);
  const [speed, setSpeed] = useState(0.2);
  const [exportFormat, setExportFormat] = useState('mp4'); // 'mp4', 'webm', 'gif'
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [touchDraggedIndex, setTouchDraggedIndex] = useState(null);
  
  const fileInputRef = useRef(null);
  const timelineRef = useRef(null);
  const isSwiping = useRef(false);
  const hasDragged = useRef(false);
  
  const touchStartCoords = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });
  const dragCoords = useRef({ x: 0, y: 0 });
  const autoScroll = useRef({ speed: 0 }); 
  const touchDraggedIndexRef = useRef(null); 
  const rafRef = useRef(null);
  const pressTimer = useRef(null);
  const ghostRef = useRef(null);
  const lastReorderTime = useRef(0);
  
  const pendingDragIndex = useRef(null);
  const isTouchDev = useRef(false);
  const activateDragRef = useRef(null);

  const isDragging = touchDraggedIndex !== null;

  // --- СИНХРОНИЗАЦИЯ ТЕМНОЙ ТЕМЫ И ФИКС ЗУМА ---
  useEffect(() => {
    // 1. Фикс для iOS/Android: жестко отключаем автоматический зум при фокусе на инпуте
    let metaViewport = document.querySelector('meta[name=viewport]');
    if (!metaViewport) {
      metaViewport = document.createElement('meta');
      metaViewport.name = 'viewport';
      document.head.appendChild(metaViewport);
    }
    metaViewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');

    // 2. Синхронизация темной темы
    const updateTheme = (e) => {
      if (e.matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };
    
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    updateTheme(mediaQuery);
    
    mediaQuery.addEventListener('change', updateTheme);
    return () => mediaQuery.removeEventListener('change', updateTheme);
  }, []);

  activateDragRef.current = (index) => {
    setTouchDraggedIndex(index);
    touchDraggedIndexRef.current = index;
    if (window.navigator?.vibrate && isTouchDev.current) window.navigator.vibrate(50);
    startAutoScrollLoop();
    pendingDragIndex.current = null; 
  };

  useEffect(() => {
    let interval;
    if (isPlaying && images.length > 0) {
      interval = setInterval(() => {
        setCurrentFrame((prev) => (prev + 1) % images.length);
      }, speed * 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, images.length, speed]);

  useEffect(() => {
    if (currentFrame >= images.length) {
      setCurrentFrame(Math.max(0, images.length - 1));
    }
    if (images.length === 0) {
      setIsPlaying(false);
    }
  }, [images.length, currentFrame]);

  useEffect(() => {
    if (isDragging) document.body.classList.add('global-dragging');
    else document.body.classList.remove('global-dragging');
    return () => document.body.classList.remove('global-dragging');
  }, [isDragging]);

  useEffect(() => {
    const handleNativeTouchMove = (e) => {
      if (touchDraggedIndexRef.current !== null) e.preventDefault();
    };
    document.addEventListener('touchmove', handleNativeTouchMove, { passive: false });
    return () => document.removeEventListener('touchmove', handleNativeTouchMove);
  }, []);

  const handleFiles = (files) => {
    const validFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
    const slotsAvailable = MAX_IMAGES - images.length;
    const filesToAdd = validFiles.slice(0, slotsAvailable);

    if (filesToAdd.length < validFiles.length) {
      alert(`LIMIT REACHED: ${MAX_IMAGES} FRAMES MAX.`);
    }

    const newImages = filesToAdd.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      url: URL.createObjectURL(file),
      file
    }));

    setImages(prev => [...prev, ...newImages]);
  };

  const onDropZone = useCallback((e) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [images.length]);

  const removeImage = (indexToRemove) => {
    setImages(prev => prev.filter((_, index) => index !== indexToRemove));
  };

  const checkReorder = (x, y, currentIndex) => {
    const now = Date.now();
    if (now - lastReorderTime.current < 150) return currentIndex; 

    const element = document.elementFromPoint(x, y);
    if (!element) return currentIndex;
    const targetFrame = element.closest('.frame-item');
    if (targetFrame) {
      const targetIndex = Number(targetFrame.dataset.index);
      if (!isNaN(targetIndex) && targetIndex !== currentIndex) {
        setImages(prev => {
          const newImages = [...prev];
          const [movedItem] = newImages.splice(currentIndex, 1);
          newImages.splice(targetIndex, 0, movedItem);
          return newImages;
        });
        lastReorderTime.current = now;
        return targetIndex;
      }
    }
    return currentIndex;
  };

  const startAutoScrollLoop = () => {
    if (rafRef.current) return;
    const loop = () => {
      if (touchDraggedIndexRef.current !== null && timelineRef.current) {
        if (autoScroll.current.speed !== 0) {
          timelineRef.current.scrollLeft += autoScroll.current.speed;
          const newIndex = checkReorder(dragCoords.current.x, dragCoords.current.y, touchDraggedIndexRef.current);
          if (newIndex !== touchDraggedIndexRef.current) {
            setTouchDraggedIndex(newIndex);
            touchDraggedIndexRef.current = newIndex;
          }
        }
        rafRef.current = requestAnimationFrame(loop);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(loop);
  };

  const handlePointerDown = (e, index) => {
    if (e.type === 'mousedown' && e.button !== 0) return;
    
    const isTouch = !!e.touches;
    isTouchDev.current = isTouch;

    const clientX = isTouch ? e.touches[0].clientX : e.clientX;
    const clientY = isTouch ? e.touches[0].clientY : e.clientY;
    const targetRect = e.currentTarget.getBoundingClientRect();
    
    touchStartCoords.current = { 
      x: clientX, 
      y: clientY,
      offsetX: clientX - targetRect.left,
      offsetY: clientY - targetRect.top
    };
    dragCoords.current = { x: clientX, y: clientY };
    isSwiping.current = false;
    hasDragged.current = false;
    
    pendingDragIndex.current = index;
    if (pressTimer.current) clearTimeout(pressTimer.current);

    pressTimer.current = setTimeout(() => {
      if (pendingDragIndex.current !== null) activateDragRef.current(pendingDragIndex.current);
    }, isTouch ? 350 : 200);
  };

  useEffect(() => {
    const handleGlobalMove = (e) => {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      dragCoords.current = { x: clientX, y: clientY };

      if (touchDraggedIndexRef.current !== null) {
        if (e.cancelable) e.preventDefault(); 
        hasDragged.current = true;
        
        if (ghostRef.current) {
          const x = clientX - touchStartCoords.current.offsetX;
          const y = clientY - touchStartCoords.current.offsetY;
          ghostRef.current.style.transform = `translate(${x}px, ${y}px) scale(1.02)`;
        }

        if (timelineRef.current) {
          const rect = timelineRef.current.getBoundingClientRect();
          const EDGE = 45; 
          const maxScroll = timelineRef.current.scrollWidth - timelineRef.current.clientWidth;
          
          if (clientX < rect.left + EDGE && timelineRef.current.scrollLeft > 0) autoScroll.current.speed = -7; 
          else if (clientX > rect.right - EDGE && timelineRef.current.scrollLeft < maxScroll) autoScroll.current.speed = 7; 
          else autoScroll.current.speed = 0; 
        }

        const newIndex = checkReorder(clientX, clientY, touchDraggedIndexRef.current);
        if (newIndex !== touchDraggedIndexRef.current) {
          setTouchDraggedIndex(newIndex);
          touchDraggedIndexRef.current = newIndex;
        }
      } else if (pendingDragIndex.current !== null) {
        const dx = Math.abs(clientX - touchStartCoords.current.x);
        const dy = Math.abs(clientY - touchStartCoords.current.y);
        
        if (dx > 5 || dy > 5) {
          if (isTouchDev.current) {
            clearTimeout(pressTimer.current);
            pendingDragIndex.current = null;
            isSwiping.current = true;
          } else {
            clearTimeout(pressTimer.current);
            activateDragRef.current(pendingDragIndex.current);
          }
        }
      }
    };

    const handleGlobalUp = () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
      if (pendingDragIndex.current !== null) pendingDragIndex.current = null;
      
      if (touchDraggedIndexRef.current !== null) {
        setCurrentFrame(touchDraggedIndexRef.current);
        setIsPlaying(false);
        setTouchDraggedIndex(null);
        touchDraggedIndexRef.current = null;
        hasDragged.current = true;
        autoScroll.current.speed = 0; 
      }
    };

    window.addEventListener('mousemove', handleGlobalMove, { passive: false });
    window.addEventListener('mouseup', handleGlobalUp);
    window.addEventListener('touchmove', handleGlobalMove, { passive: false });
    window.addEventListener('touchend', handleGlobalUp);
    window.addEventListener('touchcancel', handleGlobalUp);

    return () => {
      window.removeEventListener('mousemove', handleGlobalMove);
      window.removeEventListener('mouseup', handleGlobalUp);
      window.removeEventListener('touchmove', handleGlobalMove);
      window.removeEventListener('touchend', handleGlobalUp);
      window.removeEventListener('touchcancel', handleGlobalUp);
    };
  }, []);

  const exportVideo = async () => {
    if (images.length === 0) return;
    setIsExporting(true);
    setIsPlaying(false);

    const canvas = document.createElement('canvas');
    canvas.width = preset.width;
    canvas.height = preset.height;
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.opacity = '0.01'; 
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '-9999';
    document.body.appendChild(canvas);

    try {
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const loadedImages = await Promise.all(images.map(imgData => {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = imgData.url;
        });
      }));

      if (exportFormat === 'gif') {
        if (!window.gifshot) {
          await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/gifshot/0.3.2/gifshot.min.js';
            s.onload = res;
            s.onerror = rej;
            document.head.appendChild(s);
          });
        }
        
        const frames = loadedImages.map(img => {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          const scale = Math.max(canvas.width / img.width, canvas.height / img.height);
          const x = (canvas.width / 2) - (img.width / 2) * scale;
          const y = (canvas.height / 2) - (img.height / 2) * scale;
          ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
          return canvas.toDataURL('image/jpeg', 1.0);
        });

        window.gifshot.createGIF({
          images: frames,
          interval: speed,
          gifWidth: canvas.width,
          gifHeight: canvas.height,
          sampleInterval: 2,
          numWorkers: navigator.hardwareConcurrency || 2
        }, (obj) => {
          setIsExporting(false);
          if (document.body.contains(canvas)) document.body.removeChild(canvas);
          if (!obj.error) {
            const a = document.createElement('a');
            a.href = obj.image;
            a.download = `frame-to-frame-${Date.now()}.gif`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          } else {
            alert("Export Failed.");
          }
        });
        return; 
      }

      const stream = canvas.captureStream(30); 
      let mimeType = '';
      if (exportFormat === 'mp4') {
        if (MediaRecorder.isTypeSupported('video/mp4')) mimeType = 'video/mp4';
        else if (MediaRecorder.isTypeSupported('video/webm;codecs=h264')) mimeType = 'video/webm;codecs=h264';
        else mimeType = 'video/webm'; 
      } else {
        if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) mimeType = 'video/webm;codecs=vp9';
        else mimeType = 'video/webm';
      }

      const dummyRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1000000 });
      dummyRecorder.start();
      for (let w = 0; w < 3; w++) {
        if (loadedImages.length > 0) {
          const firstImg = loadedImages[0];
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          const scale = Math.max(canvas.width / firstImg.width, canvas.height / firstImg.height);
          const x = (canvas.width / 2) - (firstImg.width / 2) * scale;
          const y = (canvas.height / 2) - (firstImg.height / 2) * scale;
          ctx.drawImage(firstImg, x, y, firstImg.width * scale, firstImg.height * scale);
        }
        if (stream.getVideoTracks().length > 0 && stream.getVideoTracks()[0].requestFrame) {
          stream.getVideoTracks()[0].requestFrame();
        }
        await new Promise(r => setTimeout(r, 50));
      }
      dummyRecorder.stop();
      await new Promise(r => setTimeout(r, 200));

      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 50000000 });
      const chunks = [];
      recorder.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        let extension = exportFormat;
        if (mimeType.includes('webm')) extension = 'webm';
        if (mimeType.includes('mp4')) extension = 'mp4';
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `frame-to-frame-${Date.now()}.${extension}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setIsExporting(false);
        if (document.body.contains(canvas)) document.body.removeChild(canvas);
      };

      recorder.start();
      for (let i = 0; i < loadedImages.length; i++) {
        const img = loadedImages[i];
        const scale = Math.max(canvas.width / img.width, canvas.height / img.height);
        const x = (canvas.width / 2) - (img.width / 2) * scale;
        const y = (canvas.height / 2) - (img.height / 2) * scale;
        
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
        
        if (stream.getVideoTracks().length > 0 && stream.getVideoTracks()[0].requestFrame) {
            stream.getVideoTracks()[0].requestFrame();
        }
        await new Promise(r => setTimeout(r, speed * 1000));
      }
      await new Promise(r => setTimeout(r, 200));
      recorder.stop();
    } catch (error) {
      console.error(error);
      setIsExporting(false);
      if (document.body.contains(canvas)) document.body.removeChild(canvas);
    }
  };

  const getEstimatedSize = () => {
    if (images.length === 0) return '0 MB';
    const pixelCount = preset.width * preset.height;
    const totalFrames = images.length;
    
    let multiplier = 0.000000085; 
    if (exportFormat === 'webm') multiplier = 0.00000007;
    if (exportFormat === 'gif') multiplier = 0.00000015;

    const sizeMB = pixelCount * totalFrames * multiplier;
    return `~ ${sizeMB < 0.1 ? '< 0.1' : sizeMB.toFixed(1)} MB`;
  };

  const ghostX = dragCoords.current.x - touchStartCoords.current.offsetX;
  const ghostY = dragCoords.current.y - touchStartCoords.current.offsetY;

  return (
    <div className="min-h-screen md:h-screen w-full text-black dark:text-white font-mono flex flex-col md:flex-row p-2 md:p-6 gap-2 md:gap-6 relative overflow-y-auto md:overflow-hidden selection:bg-black selection:text-white dark:selection:bg-white dark:selection:text-black bg-grid">
      
      {/* Глобальный инпут для загрузки файлов */}
      <input
        type="file" multiple accept="image/*" className="hidden"
        ref={fileInputRef} onChange={(e) => { handleFiles(e.target.files); e.target.value = null; }}
      />

      {/* Mobile Header */}
      <div className="md:hidden flex shrink-0 items-center justify-between w-full px-2 z-40 pt-1">
        <h1 className="text-[11px] font-bold tracking-wider md:tracking-widest uppercase">FRAME TO FRAME</h1>
        <span className="text-[9px] text-black/40 dark:text-white/40 tracking-wider md:tracking-widest">v.1.1 (beta)</span>
      </div>

      {/* Sidebar (Settings) */}
      <div className="w-full md:w-[340px] flex flex-col shrink-0 bg-white dark:bg-[#18181b] shadow-sm border border-black/10 dark:border-white/10 rounded-2xl md:rounded-3xl z-30 order-3 md:order-1 overflow-hidden md:h-full">
        
        {/* Desktop Header */}
        <div className="hidden md:flex h-16 shrink-0 border-b border-black/5 dark:border-white/5 px-8 items-center justify-between">
          <h1 className="text-[11px] font-bold tracking-wider md:tracking-widest uppercase text-black dark:text-white">FRAME TO FRAME</h1>
          <span className="text-[10px] text-black/40 dark:text-white/40 tracking-wider md:tracking-widest">v.1.1 (beta)</span>
        </div>

        <div className="flex-1 p-4 md:p-8 flex flex-col gap-6 md:gap-10 md:overflow-y-auto custom-scrollbar">
          
          {/* Upload Block */}
          <div className="hidden md:flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[10px] text-black/50 dark:text-white/50 uppercase tracking-wider md:tracking-widest">FRAMES</h2>
              <span className="text-[10px]">{images.length}/{MAX_IMAGES}</span>
            </div>
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
              onDragLeave={() => setIsDraggingOver(false)}
              onDrop={onDropZone}
              onClick={() => fileInputRef.current?.click()}
              className={`group border border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-200
                ${isDraggingOver ? 'border-black bg-black/5 dark:border-white dark:bg-white/5' : 'border-black/10 bg-white md:hover:border-black/30 dark:border-white/10 dark:bg-[#18181b] dark:md:hover:border-white/30'}
                ${images.length >= MAX_IMAGES ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <span className="text-2xl font-light leading-none mb-3 pointer-events-none text-black/30 group-hover:text-black dark:text-white/30 dark:group-hover:text-white transition-colors">+</span>
              <p className="text-[10px] tracking-wider md:tracking-widest uppercase text-black/40 group-hover:text-black/60 dark:text-white/40 dark:group-hover:text-white/60 pointer-events-none transition-colors">Add Frames</p>
            </div>
          </div>

          {/* Settings Block */}
          <div className="flex flex-col gap-6 md:gap-8">
            
            {/* FORMAT */}
            <div className="flex flex-col gap-3 md:gap-4 px-1 md:px-0">
              <h2 className="text-[10px] text-black/50 dark:text-white/50 uppercase tracking-wider md:tracking-widest">FORMAT</h2>
              <div className="grid grid-cols-3 md:flex md:flex-col gap-2">
                {PRESETS.map(p => (
                  <button
                    key={p.id} type="button" onClick={() => { setPreset(p); setIsPlaying(false); }}
                    className={`flex flex-col items-center justify-center py-2.5 px-1 rounded-xl md:rounded-2xl border transition-all md:flex-row md:justify-between md:p-4 md:text-left
                      ${preset.id === p.id 
                        ? 'border-black bg-black text-white dark:border-white dark:bg-white dark:text-black shadow-sm' 
                        : 'border-black/10 bg-white text-black md:hover:border-black/30 dark:border-white/10 dark:bg-[#18181b] dark:text-white dark:md:hover:border-white/30'}`}
                  >
                    <span className="text-[10px] font-normal tracking-wider md:tracking-widest mb-0.5 md:mb-0">{p.name}</span>
                    <span className={`text-[8px] md:text-[10px] ${preset.id === p.id ? 'text-white/60 dark:text-black/60' : 'text-black/40 dark:text-white/40'}`}>
                      {p.width} × {p.height}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 md:gap-4 px-1 md:px-0">
              <div className="flex justify-between items-center">
                <h2 className="text-[10px] text-black/50 dark:text-white/50 uppercase tracking-wider md:tracking-widest">INTERVAL (SEC)</h2>
                <input
                  type="number" min="0.01" max="1.0" step="0.01" value={speed}
                  onChange={(e) => setSpeed(e.target.value)}
                  // Вернули hover для обводки, чтобы соответствовало плашкам
                  className="w-16 md:w-20 h-7 md:h-8 bg-white border border-black/10 rounded-full text-[10px] md:text-[11px] outline-none text-center transition-colors md:hover:border-black/30 focus:!border-black focus:ring-0 dark:bg-[#18181b] dark:border-white/10 dark:md:hover:border-white/30 dark:focus:!border-white no-spinners"
                />
              </div>
              <input
                type="range" min="0.1" max="1.0" step="0.05" value={speed === '' ? 0.1 : speed}
                onChange={(e) => setSpeed(parseFloat(e.target.value))}
                className="w-full h-8 md:h-10 appearance-none cursor-pointer custom-slider outline-none bg-transparent"
              />
            </div>

            <div className="flex flex-col gap-3 md:gap-4 px-1 md:px-0">
              <h2 className="text-[10px] text-black/50 dark:text-white/50 uppercase tracking-wider md:tracking-widest">OUTPUT</h2>
              <div className="flex border border-black/10 dark:border-white/10 p-1 bg-white dark:bg-[#18181b] rounded-full">
                {['mp4', 'webm', 'gif'].map(f => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setExportFormat(f)}
                    className={`flex-1 text-[10px] py-2 rounded-full transition-all uppercase tracking-wider md:tracking-widest
                      ${exportFormat === f 
                        ? 'bg-black text-white shadow-sm dark:bg-white dark:text-black' 
                        : 'text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white'}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <div className="text-[10px] text-black/40 dark:text-white/40 text-center uppercase tracking-wider md:tracking-widest mt-0.5">
                EST. SIZE: {getEstimatedSize()}
              </div>
            </div>

          </div>
        </div>

        {/* Footer / Export */}
        <div className="shrink-0 p-4 md:p-8 bg-white dark:bg-[#18181b] border-t border-black/5 dark:border-white/5">
          <button
            type="button" onClick={exportVideo} disabled={images.length === 0 || isExporting}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 md:py-4 rounded-full text-[11px] tracking-wider md:tracking-widest uppercase transition-all
              ${images.length === 0 || isExporting 
                ? 'bg-black/5 text-black/30 dark:bg-white/5 dark:text-white/30 cursor-not-allowed' 
                : 'bg-black text-white hover:bg-black/80 shadow-sm dark:bg-white dark:text-black dark:hover:bg-zinc-200'}`}
          >
            {isExporting ? 'RENDERING...' : 'EXPORT'}
          </button>
        </div>
      </div>

      {/* Main Content Area (Правая часть) */}
      <div className="flex-none md:flex-1 flex flex-col min-w-0 z-10 order-2 gap-2 md:gap-6">
        
        {/* Preview Area */}
        <div className="h-[50vh] md:h-auto md:flex-1 relative min-h-0 pointer-events-none">
          <div className="absolute inset-0 flex items-center justify-center">
            {images.length > 0 ? (
              <div 
                className="relative bg-white dark:bg-[#18181b] border border-black/10 dark:border-white/10 flex items-center justify-center overflow-hidden transition-all duration-300 z-10 rounded-2xl shadow-xl"
                style={{ aspectRatio: `${preset.width} / ${preset.height}`, maxHeight: '100%', maxWidth: '100%' }}
              >
                <img src={images[currentFrame]?.url} alt="Frame" className="w-full h-full object-cover pointer-events-none" />
              </div>
            ) : (
              <div className="text-black/30 dark:text-white/30 flex flex-col items-center gap-4 relative z-10 tracking-wider md:tracking-widest text-[10px]">
                NO DATA
              </div>
            )}
          </div>
        </div>

        {/* Timeline */}
        <div className="shrink-0 bg-white dark:bg-[#18181b] shadow-sm border border-black/10 dark:border-white/10 rounded-2xl md:rounded-3xl flex flex-col relative z-20 pointer-events-auto overflow-hidden">
          
          <div className="h-10 md:h-12 border-b border-black/5 dark:border-white/5 flex items-center justify-between px-4 md:px-6 bg-white dark:bg-[#18181b] z-30 relative text-[9px] md:text-[10px] uppercase tracking-wider md:tracking-widest">
            {/* Добавили flex и счетчик лимита кадров */}
            <div className="flex items-center gap-2 text-black/50 dark:text-white/50">
              <span>{images.length > 0 ? `FRAME ${currentFrame + 1} OF ${images.length}` : 'TIMELINE'}</span>
              <span className="text-black/30 dark:text-white/30">[{images.length}/{MAX_IMAGES}]</span>
            </div>
            
            <button
              type="button"
              onPointerDown={(e) => { e.preventDefault(); setIsPlaying(p => !p); }}
              disabled={images.length === 0}
              className={`w-16 md:w-20 h-7 md:h-8 flex justify-center items-center rounded-full text-[10px] md:text-[11px] transition-all ${
                images.length === 0 
                  ? 'bg-black/5 text-black/20 dark:bg-white/5 dark:text-white/30 cursor-not-allowed' 
                  : 'bg-black text-white hover:bg-black/80 shadow-sm dark:bg-white dark:text-black dark:hover:bg-zinc-200'
              }`}
            >
              {isPlaying ? 'PAUSE' : 'PLAY'}
            </button>
          </div>

          <div 
            ref={timelineRef}
            className={`h-24 md:h-36 p-3 md:p-6 flex gap-3 md:gap-4 items-center custom-scrollbar scroll-smooth-disabled overflow-x-auto overflow-y-hidden ${
              isDragging ? 'touch-none' : ''
            }`}
          >
            {images.map((img, index) => (
              <div
                key={img.id}
                data-index={index}
                className={`frame-item select-none [-webkit-touch-callout:none] relative group flex-shrink-0 w-14 h-20 md:w-20 md:h-28 cursor-grab active:cursor-grabbing border-2 rounded-xl overflow-hidden transition-colors duration-150
                  ${currentFrame === index 
                    ? 'border-black dark:border-white z-10' 
                    : 'border-black/10 md:hover:border-black/30 dark:border-white/10 dark:md:hover:border-white/30'}
                  ${touchDraggedIndex === index ? 'opacity-20' : 'opacity-100'}`}
                onMouseDown={(e) => handlePointerDown(e, index)}
                onTouchStart={(e) => handlePointerDown(e, index)}
                onClick={(e) => {
                  if (isSwiping.current || hasDragged.current) {
                    e.preventDefault(); e.stopPropagation(); return;
                  }
                  setCurrentFrame(index);
                  setIsPlaying(false);
                }}
              >
                <img 
                  src={img.url} 
                  alt="Thumb" 
                  className={`w-full h-full object-cover transition-opacity pointer-events-none ${
                    currentFrame === index ? 'opacity-100' : 'opacity-30 md:group-hover:opacity-100'
                  }`} 
                />
                
                <div className="absolute -top-6 left-0 text-[10px] text-black/40 dark:text-white/40 pointer-events-none">
                  {String(index + 1).padStart(2, '0')}
                </div>

                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeImage(index); }}
                  className={`absolute top-1 md:top-1.5 right-1 md:right-1.5 w-5 h-5 md:w-6 md:h-6 bg-black text-white dark:bg-white dark:text-black rounded-full flex items-center justify-center transition-opacity z-20
                    ${currentFrame === index && !isDragging 
                      ? 'opacity-100 pointer-events-auto' 
                      : 'opacity-0 pointer-events-none ' + (!isDragging ? 'md:group-hover:opacity-100 md:group-hover:pointer-events-auto' : '')}`}
                >
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5 md:w-3 md:h-3">
                    <line x1="3" y1="3" x2="11" y2="11" />
                    <line x1="11" y1="3" x2="3" y2="11" />
                  </svg>
                </button>
              </div>
            ))}
            
            {images.length < MAX_IMAGES && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={`group flex-shrink-0 w-14 h-20 md:w-20 md:h-28 border border-dashed border-black/10 rounded-xl md:hover:border-black/30 hover:bg-[#FAFAFA] dark:border-white/10 dark:md:hover:border-white/30 dark:hover:bg-white/5 flex items-center justify-center transition-colors ${images.length > 0 ? 'ml-1 md:ml-2' : ''}`}
              >
                <span className="text-xl md:text-2xl font-light pointer-events-none text-black/30 group-hover:text-black dark:text-white/30 dark:group-hover:text-white transition-colors">+</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* GHOST / DRAG PREVIEW */}
      <div
        ref={ghostRef}
        className={`fixed top-0 left-0 w-14 h-20 md:w-20 md:h-28 border-2 border-black dark:border-white rounded-xl bg-white/80 dark:bg-[#18181b]/80 backdrop-blur-sm shadow-xl z-[9999] pointer-events-none overflow-hidden transition-opacity duration-150 origin-top-left ${
          isDragging ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ 
          willChange: 'transform',
          transform: isDragging 
            ? `translate(${ghostX}px, ${ghostY}px) scale(1.02)`
            : 'translate(-999px, -999px)'
        }}
      >
        {isDragging && images[touchDraggedIndex] ? (
          <img src={images[touchDraggedIndex].url} className="w-full h-full object-cover opacity-80" />
        ) : null}
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 5px; height: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: transparent; border-radius: 4px; }
        .custom-scrollbar:hover::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.3); }
        .custom-scrollbar { scrollbar-width: thin; scrollbar-color: transparent transparent; }
        .custom-scrollbar:hover { scrollbar-color: rgba(0,0,0,0.15) transparent; }

        .dark .custom-scrollbar:hover::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.3); }
        .dark .custom-scrollbar:hover { scrollbar-color: rgba(255,255,255,0.15) transparent; }
        
        .global-dragging, .global-dragging * { cursor: grabbing !important; }
        
        .bg-grid {
          background-color: #F4F4F5;
          background-image: 
            linear-gradient(to right, #00000006 1px, transparent 1px),
            linear-gradient(to bottom, #00000006 1px, transparent 1px);
          background-size: 24px 24px;
          background-position: center center;
        }

        .dark .bg-grid {
          background-color: #09090b;
          background-image: 
            linear-gradient(to right, #ffffff06 1px, transparent 1px),
            linear-gradient(to bottom, #ffffff06 1px, transparent 1px);
        }

        .custom-slider::-webkit-slider-runnable-track {
          width: 100%;
          height: 1px;
          background: rgba(0,0,0,0.2);
        }
        
        .dark .custom-slider::-webkit-slider-runnable-track {
          background: rgba(255,255,255,0.2);
        }

        .custom-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #000;
          cursor: pointer;
          margin-top: -7.5px;
          box-shadow: none !important;
        }

        .dark .custom-slider::-webkit-slider-thumb {
          background: #fff;
        }

        .custom-slider::-moz-range-track {
          width: 100%;
          height: 1px;
          background: rgba(0,0,0,0.2);
          border: none;
        }

        .dark .custom-slider::-moz-range-track {
          background: rgba(255,255,255,0.2);
        }

        .custom-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #000;
          cursor: pointer;
          border: none;
          box-shadow: none !important;
        }

        .dark .custom-slider::-moz-range-thumb {
          background: #fff;
        }

        .no-spinners::-webkit-inner-spin-button, 
        .no-spinners::-webkit-outer-spin-button { 
          -webkit-appearance: none; 
          margin: 0; 
        }
        .no-spinners {
          -moz-appearance: textfield;
        }
      `}} />
    </div>
  );
}