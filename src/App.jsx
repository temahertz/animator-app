import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Upload, Film, Smartphone, Image as ImageIcon, 
  Play, Pause, Download, Trash2
} from 'lucide-react';

const PRESETS = [
  { id: 'post', name: 'Insta Post', width: 1080, height: 1440, icon: <Film className="w-4 h-4" /> },
  { id: 'square', name: 'Square', width: 1080, height: 1080, icon: <ImageIcon className="w-4 h-4" /> },
  { id: 'story', name: 'Story / Reels', width: 1080, height: 1920, icon: <Smartphone className="w-4 h-4" /> }
];

const MAX_IMAGES = 10;

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
  
  // Рефы для сенсора и единой физики
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
  
  // Добавлены новые рефы для умного старта Drag & Drop без "микрозума"
  const pendingDragIndex = useRef(null);
  const isTouchDev = useRef(false);
  const activateDragRef = useRef(null);

  const isDragging = touchDraggedIndex !== null;

  // Функция активации драга вынесена в реф для доступа из useEffect
  activateDragRef.current = (index) => {
    setTouchDraggedIndex(index);
    touchDraggedIndexRef.current = index;
    if (window.navigator?.vibrate && isTouchDev.current) window.navigator.vibrate(50);
    startAutoScrollLoop();
    pendingDragIndex.current = null; // Очищаем ожидание
  };

  // Плеер анимации
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

  // Глобальный курсор при перетаскивании
  useEffect(() => {
    if (isDragging) {
      document.body.classList.add('global-dragging');
    } else {
      document.body.classList.remove('global-dragging');
    }
    return () => document.body.classList.remove('global-dragging');
  }, [isDragging]);

  // Глобальный блокиратор нативного скролла при Drag & Drop
  useEffect(() => {
    const handleNativeTouchMove = (e) => {
      if (touchDraggedIndexRef.current !== null) {
        e.preventDefault();
      }
    };
    document.addEventListener('touchmove', handleNativeTouchMove, { passive: false });
    return () => document.removeEventListener('touchmove', handleNativeTouchMove);
  }, []);

  // Загрузка файлов
  const handleFiles = (files) => {
    const validFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
    const slotsAvailable = MAX_IMAGES - images.length;
    const filesToAdd = validFiles.slice(0, slotsAvailable);

    if (filesToAdd.length < validFiles.length) {
      alert(`You can upload up to ${MAX_IMAGES} images. Extras were ignored.`);
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

  // --- ЕДИНАЯ ФИЗИКА DRAG & DROP (Desktop + Mobile) ---
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
    
    // ВМЕСТО МГНОВЕННОГО СТАРТА: Запоминаем индекс и ждем. Это убивает "микрозум" при обычном клике!
    pendingDragIndex.current = index;
    
    if (pressTimer.current) clearTimeout(pressTimer.current);

    pressTimer.current = setTimeout(() => {
      if (pendingDragIndex.current !== null) {
        activateDragRef.current(pendingDragIndex.current);
      }
    }, isTouch ? 350 : 200);
  };

  useEffect(() => {
    const handleGlobalMove = (e) => {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      dragCoords.current = { x: clientX, y: clientY };

      if (touchDraggedIndexRef.current !== null) {
        // Мы уже перетаскиваем кадр
        if (e.cancelable) e.preventDefault(); 
        hasDragged.current = true;
        
        if (ghostRef.current) {
          const x = clientX - touchStartCoords.current.offsetX;
          const y = clientY - touchStartCoords.current.offsetY;
          ghostRef.current.style.transform = `translate(${x}px, ${y}px) scale(1.05)`;
        }

        if (timelineRef.current) {
          const rect = timelineRef.current.getBoundingClientRect();
          const EDGE = 45; 
          const maxScroll = timelineRef.current.scrollWidth - timelineRef.current.clientWidth;
          
          if (clientX < rect.left + EDGE && timelineRef.current.scrollLeft > 0) {
            autoScroll.current.speed = -7; 
          } else if (clientX > rect.right - EDGE && timelineRef.current.scrollLeft < maxScroll) {
            autoScroll.current.speed = 7; 
          } else {
            autoScroll.current.speed = 0; 
          }
        }

        const newIndex = checkReorder(clientX, clientY, touchDraggedIndexRef.current);
        if (newIndex !== touchDraggedIndexRef.current) {
          setTouchDraggedIndex(newIndex);
          touchDraggedIndexRef.current = newIndex;
        }
      } else if (pendingDragIndex.current !== null) {
        // Мы в режиме ОЖИДАНИЯ. Если мышь/палец сдвинулись больше чем на 5px:
        const dx = Math.abs(clientX - touchStartCoords.current.x);
        const dy = Math.abs(clientY - touchStartCoords.current.y);
        
        if (dx > 5 || dy > 5) {
          if (isTouchDev.current) {
            // На мобилке сдвиг до конца таймера означает СВАЙП ЛЕНТЫ. Отменяем драг.
            clearTimeout(pressTimer.current);
            pendingDragIndex.current = null;
            isSwiping.current = true;
          } else {
            // На ПК сдвиг означает МГНОВЕННЫЙ СТАРТ ДРАГА. Включаем его.
            clearTimeout(pressTimer.current);
            activateDragRef.current(pendingDragIndex.current);
          }
        }
      }
    };

    const handleGlobalUp = () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
      
      // Если мы отпустили кнопку до того как драг начался - это был просто клик.
      if (pendingDragIndex.current !== null) {
        pendingDragIndex.current = null;
      }
      
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

  // --- ЭКСПОРТ (MAX QUALITY) ---
  const exportVideo = async () => {
    if (images.length === 0) return;
    setIsExporting(true);
    setIsPlaying(false);

    // Браузеры оптимизируют элементы с opacity: 0. Используем 0.01, чтобы GPU рендерил канвас.
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

      // === ЭКСПОРТ GIF ===
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
          ctx.fillStyle = '#111827';
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
            a.download = `animation-${preset.id}-${Date.now()}.gif`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          } else {
            alert("Failed to generate GIF.");
          }
        });
        return; 
      }

      // === ЭКСПОРТ MP4 / WebM ===
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

      // === ХОЛОСТОЙ ВЫСТРЕЛ (WARMUP DUMMY RECORD) ===
      // Поскольку рендер "работает со второго раза", мы искусственно создаем этот "первый раз".
      // Запускаем временный рекордер, кидаем в него пару кадров, останавливаем и удаляем.
      // Это намертво прогревает аппаратный видеокодек.
      const dummyRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1000000 });
      dummyRecorder.start();
      for (let w = 0; w < 3; w++) {
        if (loadedImages.length > 0) {
          const firstImg = loadedImages[0];
          ctx.fillStyle = '#111827';
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
      // Ждем 200мс, чтобы кодек успешно закрыл мусорный файл и освободил мощности для настоящей записи
      await new Promise(r => setTimeout(r, 200));
      // ===============================================

      // --- НАСТОЯЩАЯ ЗАПИСЬ ---
      const recorder = new MediaRecorder(stream, { 
        mimeType,
        videoBitsPerSecond: 50000000 // 50 Mbps
      });
      
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
        a.download = `animation-${preset.id}-${Date.now()}.${extension}`;
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
        
        ctx.fillStyle = '#111827';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
        
        if (stream.getVideoTracks().length > 0 && stream.getVideoTracks()[0].requestFrame) {
            stream.getVideoTracks()[0].requestFrame();
        }
        
        await new Promise(r => setTimeout(r, speed * 1000));
      }
      
      // Ждем перед остановкой, чтобы последний кадр точно успел сохраниться
      await new Promise(r => setTimeout(r, 200));
      recorder.stop();
    } catch (error) {
      console.error("Export error:", error);
      alert("An error occurred while creating the video.");
      setIsExporting(false);
      if (document.body.contains(canvas)) {
        document.body.removeChild(canvas);
      }
    }
  };

  const ghostX = dragCoords.current.x - touchStartCoords.current.offsetX;
  const ghostY = dragCoords.current.y - touchStartCoords.current.offsetY;

  return (
    <div className="min-h-screen md:h-screen w-full bg-black text-zinc-100 font-sans flex flex-col md:flex-row md:overflow-hidden selection:bg-zinc-800 relative">
      
      {/* Mobile Header */}
      <div className="md:hidden h-14 shrink-0 bg-zinc-950 border-b border-zinc-900 px-4 flex items-center gap-3 w-full z-40 sticky top-0">
        <div className="w-7 h-7 bg-white text-black rounded flex items-center justify-center shadow-sm">
          <Film className="w-3.5 h-3.5" />
        </div>
        <h1 className="text-sm font-semibold tracking-wider text-white uppercase">Animator</h1>
      </div>

      {/* Main Content Area */}
      <div className="flex-none md:flex-1 flex flex-col min-w-0 bg-black z-10 order-1 md:order-2">
        
        {/* Preview Area */}
        <div className="h-[50vh] md:h-auto md:flex-1 relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(#222_1px,transparent_1px)] [background-size:16px_16px] opacity-40 pointer-events-none" />
          <div className="absolute inset-4 md:inset-8 flex items-center justify-center pointer-events-none">
            {images.length > 0 ? (
              <div 
                className="relative bg-zinc-950 shadow-2xl ring-1 ring-zinc-800 flex items-center justify-center overflow-hidden transition-all duration-300 z-10"
                style={{ aspectRatio: `${preset.width} / ${preset.height}`, maxHeight: '100%', maxWidth: '100%' }}
              >
                <img src={images[currentFrame]?.url} alt="Frame" className="w-full h-full object-cover pointer-events-none" />
              </div>
            ) : (
              <div className="text-zinc-600 flex flex-col items-center gap-3 relative z-10">
                <ImageIcon className="w-12 h-12 opacity-20" />
                <p className="text-sm text-zinc-500">No frames to display</p>
              </div>
            )}
          </div>
        </div>

        {/* Timeline & Player */}
        <div className="shrink-0 bg-zinc-950 border-t border-zinc-900 flex flex-col relative z-20">
          <div className="h-14 border-b border-zinc-900 flex items-center justify-center gap-4 bg-zinc-950 z-30 relative">
            <button
              type="button"
              onPointerDown={(e) => { e.preventDefault(); setIsPlaying(p => !p); }}
              disabled={images.length === 0}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all touch-manipulation ${
                images.length === 0 ? 'bg-zinc-900 text-zinc-600' : 'bg-white text-black hover:scale-105 shadow-md'
              }`}
            >
              {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-1" />}
            </button>
            <div className="text-[10px] font-mono text-zinc-500 tracking-wider">
              {images.length > 0 ? `FRAME ${currentFrame + 1} / ${images.length}` : 'IDLE'}
            </div>
          </div>

          <div 
            ref={timelineRef}
            className={`h-36 p-4 flex gap-3 items-center custom-scrollbar scroll-smooth-disabled overflow-x-auto overflow-y-hidden ${
              isDragging ? 'touch-none' : ''
            }`}
          >
            {images.map((img, index) => (
              <div
                key={img.id}
                data-index={index}
                className={`frame-item select-none [-webkit-touch-callout:none] relative group flex-shrink-0 w-20 h-28 rounded-md overflow-hidden cursor-grab active:cursor-grabbing border-2 transition-colors duration-150
                  ${currentFrame === index ? 'border-white z-10' : 'border-zinc-800 md:hover:border-zinc-600'}
                  ${touchDraggedIndex === index ? 'opacity-30' : 'opacity-100'}`}
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
                    currentFrame === index ? 'opacity-100' : 'opacity-40 md:group-hover:opacity-80'
                  }`} 
                />
                
                <div className="absolute top-1 left-1 bg-black/80 text-zinc-300 font-mono text-[9px] px-1 rounded backdrop-blur-md pointer-events-none z-20">
                  {index + 1}
                </div>

                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeImage(index); }}
                  className={`absolute top-1 right-1 bg-red-500/90 md:hover:bg-red-500 text-white p-1 rounded backdrop-blur-md transition-opacity z-20
                    ${currentFrame === index && !isDragging 
                      ? 'opacity-100 pointer-events-auto' 
                      : 'opacity-0 pointer-events-none ' + (!isDragging ? 'md:group-hover:opacity-100 md:group-hover:pointer-events-auto' : '')}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
            
            {images.length > 0 && images.length < MAX_IMAGES && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex-shrink-0 w-20 h-28 rounded-md border-2 border-dashed border-zinc-800 md:hover:border-zinc-600 hover:bg-zinc-900 flex items-center justify-center text-zinc-600 transition-colors ml-1"
              >
                <Upload className="w-5 h-5 pointer-events-none" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sidebar (Settings) */}
      <div className="w-full md:w-80 md:flex-none flex flex-col shrink-0 bg-zinc-950 md:border-r border-zinc-900 z-30 order-2 md:order-1 border-t md:border-t-0">
        <div className="hidden md:flex h-16 shrink-0 border-b border-zinc-900 px-6 items-center gap-3">
          <div className="w-8 h-8 bg-white text-black rounded flex items-center justify-center shadow-sm">
            <Film className="w-4 h-4" />
          </div>
          <h1 className="text-sm font-semibold tracking-wider text-white uppercase">Animator</h1>
        </div>

        <div className="flex-1 p-6 flex flex-col gap-8 md:overflow-y-auto custom-scrollbar">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-widest">Upload Frames</h2>
              <span className="text-xs text-zinc-500 font-mono">{images.length}/{MAX_IMAGES}</span>
            </div>
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
              onDragLeave={() => setIsDraggingOver(false)}
              onDrop={onDropZone}
              onClick={() => fileInputRef.current?.click()}
              className={`border border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-200
                ${isDraggingOver ? 'border-white bg-white/5' : 'border-zinc-800 md:hover:border-zinc-700 md:hover:bg-zinc-900/50'}
                ${images.length >= MAX_IMAGES ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <Upload className="w-5 h-5 text-zinc-400 mb-2 pointer-events-none" />
              <p className="text-sm text-zinc-300 pointer-events-none">Drag & drop files</p>
              <input
                type="file" multiple accept="image/*" className="hidden"
                ref={fileInputRef} onChange={(e) => { handleFiles(e.target.files); e.target.value = null; }}
              />
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <h2 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-widest">Settings</h2>
            
            {/* Формат проекта */}
            <div className="flex flex-col gap-3">
              <label className="text-xs text-zinc-400">Format (Resolution)</label>
              <div className="flex flex-col gap-2">
                {PRESETS.map(p => (
                  <button
                    key={p.id} type="button" onClick={() => { setPreset(p); setIsPlaying(false); }}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-all text-left group
                      ${preset.id === p.id ? 'bg-zinc-900 border-zinc-700 text-white' : 'bg-transparent border-zinc-900 text-zinc-500 md:hover:border-zinc-800 md:hover:text-zinc-300'}`}
                  >
                    <div className={`${preset.id === p.id ? 'text-white' : 'text-zinc-600'}`}>{p.icon}</div>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{p.name}</span>
                      <span className="text-[10px] text-zinc-500 font-mono mt-0.5">{p.width} × {p.height}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Скорость */}
            <div className="flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <label className="text-xs text-zinc-400">Frame Duration</label>
                <div className="flex items-center gap-1 bg-zinc-900 px-2 py-1 rounded border border-zinc-800">
                  <input
                    type="number" min="0.01" max="1.0" step="0.01" value={speed}
                    onChange={(e) => setSpeed(e.target.value)}
                    className="w-12 bg-transparent text-xs font-mono text-white outline-none text-right"
                  />
                  <span className="text-xs font-mono text-zinc-500">s</span>
                </div>
              </div>
              <input
                type="range" min="0.1" max="1.0" step="0.1" value={speed === '' ? 0.1 : speed}
                onChange={(e) => setSpeed(e.target.value)}
                className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
              />
            </div>

            {/* Формат экспорта */}
            <div className="flex flex-col gap-3 pt-2 border-t border-zinc-900">
              <label className="text-xs text-zinc-400">Export Format</label>
              <div className="flex bg-zinc-900 p-1 rounded-lg border border-zinc-800">
                {['mp4', 'webm', 'gif'].map(f => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setExportFormat(f)}
                    className={`flex-1 text-[11px] font-medium py-1.5 rounded transition-all uppercase tracking-wider
                      ${exportFormat === f ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

          </div>
        </div>

        <div className="shrink-0 p-4 md:p-6 border-t border-zinc-900 bg-zinc-950 sticky bottom-0 z-40">
          <button
            type="button" onClick={exportVideo} disabled={images.length === 0 || isExporting}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 text-sm rounded font-medium transition-all
              ${images.length === 0 || isExporting ? 'bg-zinc-900 text-zinc-600 cursor-not-allowed' : 'bg-white md:hover:bg-zinc-200 text-black shadow-sm'}`}
          >
            {isExporting ? <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : <Download className="w-4 h-4" />}
            {isExporting ? 'Rendering...' : 'Export'}
          </button>
        </div>
      </div>

      {/* GHOST / DRAG PREVIEW */}
      <div
        ref={ghostRef}
        className={`fixed top-0 left-0 w-20 h-28 rounded-md border-2 border-white shadow-2xl z-[9999] pointer-events-none overflow-hidden transition-opacity duration-150 origin-top-left ${
          isDragging ? 'opacity-90' : 'opacity-0'
        }`}
        style={{ 
          willChange: 'transform',
          transform: isDragging 
            ? `translate(${ghostX}px, ${ghostY}px) scale(1.05)`
            : 'translate(-999px, -999px)'
        }}
      >
        {isDragging && images[touchDraggedIndex] ? (
          <img src={images[touchDraggedIndex].url} className="w-full h-full object-cover" />
        ) : null}
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #09090b; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #27272a; border-radius: 3px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #3f3f46; }
        .global-dragging, .global-dragging * { cursor: grabbing !important; }
      `}} />
    </div>
  );
}