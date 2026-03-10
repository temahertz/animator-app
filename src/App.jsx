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
  const [exportFormat, setExportFormat] = useState('mp4');
  
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
    let metaViewport = document.querySelector('meta[name=viewport]');
    if (!metaViewport) {
      metaViewport = document.createElement('meta');
      metaViewport.name = 'viewport';
      document.head.appendChild(metaViewport);
    }
    metaViewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');

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
    return `${sizeMB < 0.1 ? '< 0.1' : sizeMB.toFixed(1)} MB`;
  };

  const nextFrame = (e) => {
    if (e) e.preventDefault();
    if (images.length === 0) return;
    setIsPlaying(false);
    setCurrentFrame(prev => (prev + 1) % images.length);
  };

  const prevFrame = (e) => {
    if (e) e.preventDefault();
    if (images.length === 0) return;
    setIsPlaying(false);
    setCurrentFrame(prev => (prev - 1 + images.length) % images.length);
  };

  const ghostX = dragCoords.current.x - touchStartCoords.current.offsetX;
  const ghostY = dragCoords.current.y - touchStartCoords.current.offsetY;

  const presetIndex = PRESETS.findIndex(p => p.id === preset.id);
  const formatIndex = ['mp4', 'webm', 'gif'].indexOf(exportFormat);
  const speedValue = speed === '' ? 0.1 : parseFloat(speed);
  const speedPercent = Math.max(0, Math.min(100, ((speedValue - 0.1) / 0.9) * 100));

  return (
    <div className="min-h-[100dvh] w-full text-black dark:text-white font-mono flex flex-col items-center relative overflow-y-auto overflow-x-hidden selection:bg-black selection:text-white dark:selection:bg-white dark:selection:text-black bg-grid px-4">
      
      <input
        type="file" multiple accept="image/*" className="hidden"
        ref={fileInputRef} onChange={(e) => { handleFiles(e.target.files); e.target.value = null; }}
      />

      {/* Вынесенная фиксированная шапка */}
      <div className="fixed top-0 left-0 w-full px-[24px] py-[24px] flex justify-between items-start z-50 pointer-events-none">
        <h1 className="text-[12px] tracking-widest uppercase font-medium opacity-60">FRAME TO FRAME</h1>
        <span className="text-[10px] text-black/40 dark:text-white/40 tracking-widest">v.11.0 (refined)</span>
      </div>

      {/* Центральный контейнер.
        СУЖЕН ДО 360px для идеальных пропорций мобильного экрана.
        Анимация трансформации при старте (Zero State -> Reveal)
      */}
      <div 
        className="w-full max-w-[360px] flex flex-col gap-[20px] z-10 relative pt-[82px] pb-[40px] transition-transform duration-[800ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ transform: images.length === 0 ? 'translateY(15vh)' : 'translateY(0)' }}
      >

        {/* 1. ОБЪЕДИНЕННАЯ ПЛАШКА (ПРЕВЬЮ + ТАЙМЛАЙН) */}
        <div 
          className={`bg-white dark:bg-[#121212] rounded-[24px] flex flex-col relative shrink-0 overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] shadow-[0_12px_40px_rgba(0,0,0,0.06)] dark:shadow-none
            ${images.length === 0 ? 'h-[320px] scale-100' : 'h-[520px]'}
            ${isDraggingOver && images.length === 0 ? 'bg-[#fafafa] dark:bg-[#18181b] scale-[0.98]' : ''}
          `}
          onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={onDropZone}
        >
          {/* Overlay для Drag&Drop */}
          {isDraggingOver && images.length > 0 && (
            <div className="absolute inset-0 bg-white/80 dark:bg-[#121212]/90 backdrop-blur-md z-50 flex flex-col items-center justify-center pointer-events-none animate-reveal-fast">
               <div className="w-16 h-16 rounded-full bg-[#f4f4f5] dark:bg-[#1C1C1E] flex items-center justify-center mb-4 shadow-sm border border-black/5 dark:border-white/5">
                 <span className="text-3xl font-light leading-none text-black/50 dark:text-white/50 mb-1">+</span>
               </div>
               <h3 className="text-[12px] tracking-widest uppercase font-medium">DROP TO ADD</h3>
            </div>
          )}

          {images.length === 0 ? (
            /* ZERO STATE (Чистое стартовое окно) */
            <div className="flex-1 flex flex-col items-center justify-center animate-fade-in h-full w-full">
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="group flex flex-col items-center justify-center w-full h-full transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-105 active:scale-95"
              >
                <div className="w-20 h-20 rounded-full bg-[#f4f4f5] dark:bg-[#1C1C1E] flex items-center justify-center mb-5 transition-colors duration-300 group-hover:bg-[#ebebeb] dark:group-hover:bg-[#27272a] shadow-sm dark:shadow-none">
                  <span className="text-4xl font-light leading-none text-black/40 dark:text-white/40 mb-1 pointer-events-none">+</span>
                </div>
                <h3 className="text-[11px] tracking-widest uppercase mb-1 text-black/60 dark:text-white/60 font-medium">START PROJECT</h3>
                <span className="text-[9px] tracking-widest uppercase text-black/30 dark:text-white/30">Drag & Drop</span>
              </button>
            </div>
          ) : (
            /* ACTIVE APP STATE */
            <>
              {/* Preview Area - Идеально фиксирует картинку, не ломая флекс-контейнер */}
              <div className="p-[20px] flex flex-col items-center justify-center relative shrink-0 h-[348px] w-full animate-fade-in">
                <div className="w-full h-full flex items-center justify-center">
                  <img 
                    src={images[currentFrame]?.url} 
                    alt="Frame" 
                    className="rounded-[16px] shadow-[0_8px_24px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.4)] bg-[#f4f4f5] dark:bg-[#09090b] object-cover pointer-events-none transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
                    style={{ aspectRatio: `${preset.width} / ${preset.height}`, maxHeight: '100%', maxWidth: '100%' }}
                  />
                </div>
              </div>

              {/* Timeline Area (172px) */}
              <div className="flex flex-col flex-1 min-h-0 animate-fade-in">
                
                {/* Центрированный Плеер (Без текста SEQUENCE) */}
                <div className="h-[44px] px-[20px] flex items-center justify-center z-30 relative shrink-0">
                  <div className="flex items-center p-1 gap-1.5 bg-[#f4f4f5] dark:bg-[#1C1C1E] rounded-full border border-black/5 dark:border-white/5 shadow-inner">
                    <button 
                      type="button" onPointerDown={prevFrame} 
                      className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10 active:scale-90 transition-all text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white"
                    >
                      <svg fill="currentColor" viewBox="0 0 24 24" className="w-4 h-4"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
                    </button>
                    
                    <button 
                      type="button" onPointerDown={(e) => { e.preventDefault(); setIsPlaying(!isPlaying); }} 
                      className="w-10 h-10 flex items-center justify-center rounded-full bg-white dark:bg-[#27272a] shadow-sm active:scale-95 transition-all text-black dark:text-white"
                    >
                      {isPlaying ? (
                        <svg fill="currentColor" viewBox="0 0 24 24" className="w-3.5 h-3.5"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                      ) : (
                        <svg fill="currentColor" viewBox="0 0 24 24" className="w-3.5 h-3.5 ml-0.5"><path d="M8 5v14l11-7z"/></svg>
                      )}
                    </button>
                    
                    <button 
                      type="button" onPointerDown={nextFrame} 
                      className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10 active:scale-90 transition-all text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white"
                    >
                      <svg fill="currentColor" viewBox="0 0 24 24" className="w-4 h-4"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                    </button>
                  </div>
                </div>

                {/* Scroll Area - ДОБАВЛЕНЫ ОТСТУПЫ py-4, чтобы активный кадр не обрезался при увеличении (scale) */}
                <div 
                  ref={timelineRef}
                  className={`flex-1 px-[20px] py-[16px] flex gap-[12px] items-center custom-scrollbar scroll-smooth-disabled overflow-x-auto min-h-0 ${
                    isDragging ? 'touch-none' : ''
                  }`}
                >
                  {images.map((img, index) => (
                    <div
                      key={img.id}
                      data-index={index}
                      className={`frame-item select-none [-webkit-touch-callout:none] relative group flex-shrink-0 w-[52px] h-[72px] cursor-grab active:cursor-grabbing rounded-[12px] overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
                        ${currentFrame === index 
                          ? 'scale-[1.15] shadow-[0_8px_16px_rgba(0,0,0,0.12)] ring-[1.5px] ring-black dark:ring-white z-10 opacity-100' 
                          : 'scale-[0.95] ring-1 ring-black/10 dark:ring-white/10 opacity-40 hover:opacity-80 hover:scale-100'}
                        ${touchDraggedIndex === index ? 'opacity-20' : ''}`}
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
                        className={`absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-300 ${currentFrame === index ? 'opacity-100' : ''}`} 
                      />
                      
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeImage(index); }}
                        className={`absolute top-0.5 right-0.5 w-4 h-4 bg-black/80 backdrop-blur-sm text-white dark:bg-white/90 dark:text-black rounded-full flex items-center justify-center transition-all duration-200 z-20
                          ${currentFrame === index && !isDragging 
                            ? 'opacity-100 scale-100 pointer-events-auto' 
                            : 'opacity-0 scale-75 pointer-events-none group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto'}`}
                      >
                        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5">
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
                      className="group flex-shrink-0 w-[52px] h-[72px] bg-[#f4f4f5] dark:bg-[#1C1C1E] rounded-[12px] hover:bg-[#ebebeb] dark:hover:bg-[#27272a] active:scale-95 flex flex-col items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] gap-1 border border-black/5 dark:border-white/5 ml-1"
                    >
                      <span className="text-xl font-light pointer-events-none text-black/40 group-hover:text-black dark:text-white/40 dark:group-hover:text-white transition-colors leading-none">+</span>
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* PROGRESSIVE DISCLOSURE */}
        {images.length > 0 && (
          <>
            {/* 2. COMPACT SETTINGS BENTO (SIZE & SPEED) - Расположены ВЫШЕ экспорта */}
            <div className="bg-white dark:bg-[#121212] rounded-[24px] p-[20px] flex flex-col justify-between shrink-0 h-[196px] animate-reveal delay-1 shadow-[0_12px_40px_rgba(0,0,0,0.04)] dark:shadow-none border border-black/5 dark:border-white/5">
              
              {/* Magic Motion Format Selector */}
              <div className="flex flex-col gap-[12px]">
                <h2 className="text-[10px] text-black/50 dark:text-white/50 uppercase tracking-widest leading-[14px] font-medium">SIZE</h2>
                <div className="relative flex w-full bg-[#f4f4f5] dark:bg-[#1C1C1E] p-1 rounded-[20px] h-[72px]">
                  
                  {/* Sliding Indicator (ЧИСТЫЙ ЧЕРНЫЙ, БЕЗ ТЕНИ) */}
                  <div 
                    className="absolute top-1 bottom-1 bg-black dark:bg-white rounded-[16px] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
                    style={{ 
                      width: 'calc((100% - 8px) / 3)', 
                      transform: `translateX(calc(${presetIndex} * 100%))` 
                    }}
                  />
                  
                  {PRESETS.map((p) => (
                    <button
                      key={p.id} type="button" onClick={() => { setPreset(p); setIsPlaying(false); }}
                      className={`flex-1 flex flex-col items-center justify-center relative z-10 transition-colors duration-300
                        ${preset.id === p.id 
                          ? 'text-white dark:text-black font-medium' 
                          : 'text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white'}`}
                    >
                      <span className="text-[10px] tracking-widest mb-0.5">{p.name}</span>
                      <span className={`text-[8px] transition-colors ${preset.id === p.id ? 'text-white/60 dark:text-black/60' : 'text-black/40 dark:text-white/40'}`}>
                        {p.width}×{p.height}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Speed Row */}
              <div className="flex items-center justify-between gap-[16px] h-[48px]">
                <h2 className="text-[10px] text-black/50 dark:text-white/50 uppercase tracking-widest shrink-0 w-[44px] font-medium">SPEED</h2>
                
                {/* Кастомный ползунок */}
                <div className="flex-1 relative h-[24px] flex items-center group touch-none">
                  <div className="absolute w-full h-[6px] bg-[#f4f4f5] dark:bg-[#1C1C1E] rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-black dark:bg-white transition-all duration-75" 
                      style={{ width: `${speedPercent}%` }}
                    />
                  </div>
                  <input
                    type="range" min="0.1" max="1.0" step="0.05" value={speed === '' ? 0.1 : speed}
                    onChange={(e) => setSpeed(parseFloat(e.target.value))}
                    className="absolute w-full h-full opacity-0 cursor-pointer z-20"
                  />
                  <div 
                    className="absolute w-[18px] h-[18px] bg-white dark:bg-[#e4e4e7] border border-black/5 dark:border-white/10 rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.15)] pointer-events-none transition-transform duration-100 ease-out group-active:scale-[1.3] z-10"
                    style={{ left: `calc(${speedPercent}% - 9px)` }}
                  />
                </div>

                <input
                  type="number" min="0.01" max="1.0" step="0.01" value={speed}
                  onChange={(e) => setSpeed(e.target.value)}
                  className="w-[60px] h-full bg-[#f4f4f5] rounded-[16px] text-[10px] outline-none text-center transition-colors dark:bg-[#1C1C1E] font-medium no-spinners"
                />
              </div>
            </div>

            {/* 3. EXPORT BENTO */}
            <div className="bg-white dark:bg-[#121212] rounded-[24px] p-[20px] flex flex-col justify-between shrink-0 h-[196px] animate-reveal delay-2 shadow-[0_12px_40px_rgba(0,0,0,0.04)] dark:shadow-none border border-black/5 dark:border-white/5">
              
              {/* Magic Motion Output Format Selector */}
              <div className="flex flex-col gap-[12px]">
                <h2 className="text-[10px] text-black/50 dark:text-white/50 uppercase tracking-widest leading-[14px] font-medium">OUTPUT</h2>
                <div className="relative flex w-full bg-[#f4f4f5] dark:bg-[#1C1C1E] p-1 rounded-full h-[48px]">
                  
                  {/* Sliding Indicator (ЧИСТЫЙ ЧЕРНЫЙ, БЕЗ ТЕНИ) */}
                  <div 
                    className="absolute top-1 bottom-1 bg-black dark:bg-white rounded-full transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
                    style={{ 
                      width: 'calc((100% - 8px) / 3)', 
                      transform: `translateX(calc(${formatIndex} * 100%))` 
                    }}
                  />

                  {['mp4', 'webm', 'gif'].map((f) => (
                    <button
                      key={f} type="button" onClick={() => setExportFormat(f)}
                      className={`flex-1 relative z-10 flex items-center justify-center text-[10px] tracking-widest transition-colors duration-300 uppercase h-full
                        ${exportFormat === f 
                          ? 'text-white dark:text-black font-medium' 
                          : 'text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white'}`}
                    >
                      <span>{f}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Export Centered */}
              <div className="flex flex-col items-center gap-[12px]">
                <div className="text-[10px] text-black/40 dark:text-white/40 tracking-widest uppercase leading-[14px] font-medium">
                  EST. SIZE: {getEstimatedSize()}
                </div>

                <button
                  type="button" onClick={exportVideo} disabled={images.length === 0 || isExporting}
                  className={`flex items-center justify-center w-full h-[48px] rounded-full text-[11px] tracking-widest uppercase transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
                    ${images.length === 0 || isExporting 
                      ? 'bg-[#f4f4f5] text-black/30 dark:bg-[#1C1C1E] dark:text-white/30 cursor-not-allowed' 
                      : 'bg-black text-white hover:scale-[0.98] active:scale-95 dark:bg-white dark:text-black shadow-md dark:shadow-none'}`}
                >
                  {isExporting ? (
                    <span className="animate-pulse font-medium">...</span>
                  ) : (
                    <span className="font-medium">EXPORT</span>
                  )}
                </button>
              </div>

            </div>
          </>
        )}

      </div>

      {/* GHOST / DRAG PREVIEW */}
      <div
        ref={ghostRef}
        className={`fixed top-0 left-0 w-[52px] h-[72px] cursor-grabbing rounded-[12px] bg-white/80 dark:bg-[#121212]/80 backdrop-blur-md z-[9999] pointer-events-none overflow-hidden transition-opacity duration-150 origin-top-left ${
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
          <img src={images[touchDraggedIndex].url} className="absolute inset-0 w-full h-full object-cover opacity-80" />
        ) : null}
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        /* PREMIUM ANIMATIONS (Swiss/Framer Style) */
        @keyframes revealUp {
          0% { opacity: 0; transform: translateY(30px) scale(0.98); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes fadeIn {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        .animate-reveal {
          animation: revealUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .animate-reveal-fast {
          animation: revealUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .animate-fade-in {
          animation: fadeIn 0.6s ease-in forwards;
        }
        .delay-1 { animation-delay: 0.1s; opacity: 0; }
        .delay-2 { animation-delay: 0.2s; opacity: 0; }

        /* Убираем нативный скроллбар для красоты, оставляя функционал */
        .custom-scrollbar::-webkit-scrollbar { display: none; }
        .custom-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        
        .global-dragging, .global-dragging * { cursor: grabbing !important; }
        
        /* СТРОГО СОВМЕЩЕННАЯ СЕТКА */
        .bg-grid {
          background-color: #F4F4F5;
          background-image: 
            linear-gradient(to right, rgba(0,0,0,0.04) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(0,0,0,0.04) 1px, transparent 1px);
          background-size: 24px 24px;
          background-position: calc(50% - 12px) top;
        }

        .dark .bg-grid {
          background-color: #09090b;
          background-image: 
            linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px);
          background-position: calc(50% - 12px) top;
        }

        .custom-slider::-webkit-slider-runnable-track {
          width: 100%;
          height: 1px;
          background: rgba(0,0,0,0.2);
          transition: background 0.3s;
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
          transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        
        .custom-slider::-webkit-slider-thumb:hover {
          transform: scale(1.2);
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
          transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        
        .custom-slider::-moz-range-thumb:hover {
          transform: scale(1.2);
        }

        .dark .custom-slider::-moz-range-thumb {
          background: #fff;
        }

        .no-spinners::-webkit-inner-spin-button, 
        .no-spinners::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        .no-spinners { -moz-appearance: textfield; }
      `}} />
    </div>
  );
}