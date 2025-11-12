
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { SparkleIcon, SpinnerIcon, UploadIcon, PictureIcon, ResetIcon } from './components/Icons';

// Helper to convert data URL to base64 string and mimeType
function dataUrlToInfo(dataUrl: string): { base64Data: string; mimeType: string } {
    const parts = dataUrl.split(',');
    const mimeType = parts[0].match(/:(.*?);/)?.[1] || 'application/octet-stream';
    const base64Data = parts[1];
    return { base64Data, mimeType };
}

type Point = { x: number; y: number };

const DraggablePad: React.FC<{
    label: string;
    offset: Point;
    setOffset: (offset: Point) => void;
    padSize?: number;
    handleSize?: number;
    padClassName?: string;
    handleClassName?: string;
}> = ({ 
    label, 
    offset, 
    setOffset, 
    padSize = 128, 
    handleSize = 32,
    padClassName = "bg-gray-700",
    handleClassName = "bg-sky-500"
}) => {
    const padRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);

    const handleInteractionStart = (e: React.MouseEvent | React.TouchEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleInteractionMove = (e: MouseEvent | TouchEvent) => {
        if (!isDragging || !padRef.current) return;
        
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        
        const rect = padRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        let dx = clientX - centerX;
        let dy = clientY - centerY;
        
        const radius = rect.width / 2;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > radius) {
            dx = (dx / distance) * radius;
            dy = (dy / distance) * radius;
        }

        setOffset({ x: dx, y: dy });
    };

    const handleInteractionEnd = () => {
        setIsDragging(false);
    };

    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleInteractionMove);
            window.addEventListener('touchmove', handleInteractionMove);
            window.addEventListener('mouseup', handleInteractionEnd);
            window.addEventListener('touchend', handleInteractionEnd);
        }
        return () => {
            window.removeEventListener('mousemove', handleInteractionMove);
            window.removeEventListener('touchmove', handleInteractionMove);
            window.removeEventListener('mouseup', handleInteractionEnd);
            window.removeEventListener('touchend', handleInteractionEnd);
        };
    }, [isDragging, setOffset]);
    
    return (
        <div className="flex flex-col items-center">
            <label className="text-sm font-medium mb-2">{label}</label>
            <div
                ref={padRef}
                className={`rounded-full flex items-center justify-center relative touch-none ${padClassName}`}
                style={{touchAction: 'none', width: `${padSize}px`, height: `${padSize}px`}}
                onMouseDown={handleInteractionStart}
                onTouchStart={handleInteractionStart}
            >
                <div 
                  className={`rounded-full absolute cursor-grab active:cursor-grabbing ${handleClassName}`}
                  style={{ 
                    width: `${handleSize}px`, height: `${handleSize}px`,
                    transform: `translate(${offset.x}px, ${offset.y}px)`
                  }}
                />
            </div>
        </div>
    );
};


const App: React.FC = () => {
    const [originalImage, setOriginalImage] = useState<string | null>(null);
    const [editedImage, setEditedImage] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [gazeOffset, setGazeOffset] = useState<Point>({ x: 0, y: 0 });
    const [headOffset, setHeadOffset] = useState<Point>({ x: 0, y: 0 });
    const [bodyOffset, setBodyOffset] = useState<Point>({ x: 0, y: 0 });


    const fileInputRef = useRef<HTMLInputElement>(null);
    
    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setOriginalImage(reader.result as string);
                setEditedImage(null);
                handleReset();
            };
            reader.readAsDataURL(file);
        }
    };

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };
    
    const handleReset = () => {
        setGazeOffset({ x: 0, y: 0 });
        setHeadOffset({ x: 0, y: 0 });
        setBodyOffset({ x: 0, y: 0 });
        setError(null);
    };

    const generatePrompt = () => {
        let promptParts = [];
        const threshold = 15;
        
        const headDistance = Math.sqrt(headOffset.x ** 2 + headOffset.y ** 2);
        if (headDistance > threshold) {
            let vertical = headOffset.y < -threshold ? "up" : (headOffset.y > threshold ? "down" : "");
            let horizontal = headOffset.x < -threshold ? "left" : (headOffset.x > threshold ? "right" : "");
            const headDirection = [vertical, horizontal].filter(Boolean).join(' and to the ');
            
            const padRadius = 64; // half of default padSize
            let tiltAmount = "";
            if (headDistance > padRadius * 0.75) {
                tiltAmount = "significantly ";
            } else if (headDistance < padRadius * 0.4) {
                tiltAmount = "slightly ";
            }
        
            if (headDirection) {
                promptParts.push(`Tilt the main subject's head ${tiltAmount}${headDirection}.`);
            }
        }


        const bodyDistance = Math.sqrt(bodyOffset.x ** 2 + bodyOffset.y ** 2);
        if (bodyDistance > threshold) {
            let vertical = bodyOffset.y < -threshold ? "up" : (bodyOffset.y > threshold ? "down" : "");
            let horizontal = bodyOffset.x < -threshold ? "left" : (bodyOffset.x > threshold ? "right" : "");
            const bodyDirection = [vertical, horizontal].filter(Boolean).join(' and to the ');
            
            const padRadius = 80; // half of padSize for body pad
            let turnAmount = "";
            if (bodyDistance > padRadius * 0.75) {
                turnAmount = "significantly ";
            } else if (bodyDistance < padRadius * 0.4) {
                turnAmount = "slightly ";
            }
        
            if (bodyDirection) {
                promptParts.push(`Turn the main subject's body ${turnAmount}to face ${bodyDirection}.`);
            }
        }

        const gazeDistance = Math.sqrt(gazeOffset.x ** 2 + gazeOffset.y ** 2);
        if (gazeDistance > threshold) {
             let vertical = gazeOffset.y < -threshold ? "up" : (gazeOffset.y > threshold ? "down" : "");
             let horizontal = gazeOffset.x < -threshold ? "left" : (gazeOffset.x > threshold ? "right" : "");
             const gazeDirection = [vertical, horizontal].filter(Boolean).join(' and to the ');
             if(gazeDirection) promptParts.push(`Make the subject look ${gazeDirection}.`);
        }

        if (promptParts.length === 0) {
            return "Make a high-quality, photorealistic image of the subject, keeping the style the same.";
        }
        return promptParts.join(' ');
    };

    const generateImage = async () => {
        if (!originalImage) {
            setError("Please upload an image first.");
            return;
        }

        setIsLoading(true);
        setError(null);
        setEditedImage(null);

        try {
            if (!process.env.API_KEY) {
                throw new Error("API_KEY is not set in environment variables.");
            }
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            const { base64Data, mimeType } = dataUrlToInfo(originalImage);
            const prompt = generatePrompt();

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents: {
                    parts: [
                        { inlineData: { data: base64Data, mimeType: mimeType } },
                        { text: prompt },
                    ],
                },
                config: {
                    responseModalities: [Modality.IMAGE],
                },
            });

            const imagePart = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);
            if (imagePart && imagePart.inlineData) {
                const newImageDataBase64 = imagePart.inlineData.data;
                const newImageMimeType = imagePart.inlineData.mimeType;
                setEditedImage(`data:${newImageMimeType};base64,${newImageDataBase64}`);
            } else {
                throw new Error("No image was generated. The response may have been blocked.");
            }

        } catch (e: any) {
            setError(e.message || "An unexpected error occurred.");
        } finally {
            setIsLoading(false);
        }
    };
    
    const ImageDisplay = ({ src, title }: { src: string | null, title: string }) => (
        <div className="w-full lg:w-1/2 p-2">
            <h2 className="text-lg font-semibold text-center mb-2">{title}</h2>
            <div className="aspect-square bg-gray-800 rounded-lg flex items-center justify-center overflow-hidden relative shadow-lg">
                {src ? (
                    <img src={src} alt={title} className="object-contain w-full h-full" />
                ) : (
                    <div className="text-gray-500">
                        {title === 'Original' ? <UploadIcon className="w-16 h-16" /> : <PictureIcon className="w-16 h-16" />}
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="min-h-screen flex flex-col font-sans bg-gray-900 text-white">
            <header className="p-4 border-b border-gray-700 shadow-md">
                <h1 className="text-2xl font-bold text-center tracking-wide">Character Pose Editor</h1>
            </header>

            <main className="flex-grow p-4 md:p-8 flex flex-col items-center">
                 {!originalImage ? (
                    <div className="flex-grow flex flex-col items-center justify-center">
                        <button
                            onClick={handleUploadClick}
                            className="bg-sky-600 hover:bg-sky-700 text-white font-bold py-4 px-8 rounded-lg flex items-center gap-3 transition-transform duration-200 ease-in-out hover:scale-105 text-lg shadow-lg"
                        >
                            <UploadIcon className="w-8 h-8" />
                            Upload an Image to Start
                        </button>
                    </div>
                ) : (
                    <div className="w-full max-w-7xl flex flex-col items-center">
                        <div className="w-full flex flex-col lg:flex-row items-start justify-center">
                             <ImageDisplay src={originalImage} title="Original" />
                            <ImageDisplay src={editedImage} title="Edited" />
                        </div>
                         {error && (
                            <div className="mt-4 text-center text-red-400 bg-red-900/50 p-3 rounded-lg max-w-2xl w-full">
                                <p><strong>Error:</strong> {error}</p>
                            </div>
                        )}
                    </div>
                )}
            </main>
            
            {originalImage && (
                <footer className="p-4 border-t border-gray-700 bg-gray-800/50 sticky bottom-0">
                    <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-center gap-8">
                        
                        <div className="flex items-center justify-center gap-8">
                            <DraggablePad 
                                label="Gaze Direction" 
                                offset={gazeOffset} 
                                setOffset={setGazeOffset} 
                            />
                             <DraggablePad 
                                label="Head Pose" 
                                offset={headOffset} 
                                setOffset={setHeadOffset}
                                handleClassName="bg-cyan-500"
                            />
                             <DraggablePad 
                                label="Body Pose" 
                                offset={bodyOffset} 
                                setOffset={setBodyOffset}
                                padSize={160}
                                handleSize={48}
                                handleClassName="bg-fuchsia-500/50 border-2 border-fuchsia-400 rounded-full"
                            />
                        </div>

                        <div className="h-24 w-px bg-gray-600 hidden md:block"></div>

                        <div className="flex items-center gap-4">
                            <button onClick={handleReset} title="Reset Controls" className="flex items-center gap-2 px-6 py-3 rounded-lg transition-colors text-left font-medium bg-gray-700 hover:bg-gray-600">
                                <ResetIcon className="w-6 h-6" />
                                <span>Reset</span>
                           </button>
                           <button onClick={generateImage} title="Generate Image" className="flex items-center gap-2 px-8 py-4 rounded-lg text-white font-bold disabled:bg-gray-500 disabled:cursor-not-allowed transition-transform duration-200 ease-in-out hover:scale-105 bg-green-600 hover:bg-green-700 text-lg" disabled={isLoading}>
                               {isLoading ? <SpinnerIcon className="w-6 h-6"/> : <SparkleIcon className="w-6 h-6" />}
                               <span>{isLoading ? 'Generating...' : 'Generate'}</span>
                           </button>
                        </div>

                    </div>
                </footer>
            )}

            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                accept="image/png, image/jpeg, image/webp"
            />
        </div>
    );
};

export default App;
