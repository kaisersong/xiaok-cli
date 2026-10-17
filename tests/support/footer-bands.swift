// Native acceptance helper: locate xterm gray 238 bands in a window screenshot.
import Foundation
import CoreGraphics
import ImageIO
for name in CommandLine.arguments.dropFirst() {
 guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: name) as CFURL, nil), let im = CGImageSourceCreateImageAtIndex(src, 0, nil) else { fatalError("image") }
 let w=im.width, h=im.height
 var bytes=[UInt8](repeating:0,count:w*h*4)
 bytes.withUnsafeMutableBytes { ptr in
  let ctx=CGContext(data:ptr.baseAddress,width:w,height:h,bitsPerComponent:8,bytesPerRow:w*4,space:CGColorSpace(name:CGColorSpace.sRGB)!,bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.draw(im,in:CGRect(x:0,y:0,width:w,height:h))
 }
 var bands=[[Int]]()
 for y in 0..<h {
  var count=0
  for x in 0..<w { let o=(y*w+x)*4; if bytes[o]==68 && bytes[o+1]==68 && bytes[o+2]==68 { count+=1 } }
  if count>w/8 { if let last=bands.last, last[1]==y-1 {bands[bands.count-1][1]=y} else {bands.append([y,y])} }
 }
 let data=try! JSONSerialization.data(withJSONObject:["image":name,"width":w,"height":h,"bands":bands],options:[.sortedKeys])
 print(String(data:data,encoding:.utf8)!)
}
