/*
control character types:
1 - metadata
2 - symbols
6 - false
7 - true
8- 16 - negative doubles
16-24 positive doubles
27 - String starts with a character 27 or less or is an empty string
0 - multipart separator
> 27 normal string characters
*/
/*
* Convert arbitrary scalar values to buffer bytes with type preservation and type-appropriate ordering
*/

const float64Array = new Float64Array(2)
const int32Array = new Int32Array(float64Array.buffer, 0, 4)

/*
* Convert arbitrary scalar values to buffer bytes with type preservation and type-appropriate ordering
*/
function writeKey(key, target, position, inSequence) {
	switch (typeof key) {
  case 'string':
		let strLength = key.length
    let c1 = key.charCodeAt(0)
    if (c1 < 28) // escape character
      target[position++] = 27
		if (strLength < 0x20) {
			let i, c2
			for (i = 0; i < strLength; i++) {
				c1 = key.charCodeAt(i)
				if (c1 < 0x80) {
					target[position++] = c1
				} else if (c1 < 0x800) {
					target[position++] = c1 >> 6 | 0xc0
					target[position++] = c1 & 0x3f | 0x80
				} else if (
					(c1 & 0xfc00) === 0xd800 &&
					((c2 = key.charCodeAt(i + 1)) & 0xfc00) === 0xdc00
				) {
					c1 = 0x10000 + ((c1 & 0x03ff) << 10) + (c2 & 0x03ff)
					i++
					target[position++] = c1 >> 18 | 0xf0
					target[position++] = c1 >> 12 & 0x3f | 0x80
					target[position++] = c1 >> 6 & 0x3f | 0x80
					target[position++] = c1 & 0x3f | 0x80
				} else {
					target[position++] = c1 >> 12 | 0xe0
					target[position++] = c1 >> 6 & 0x3f | 0x80
					target[position++] = c1 & 0x3f | 0x80
				}
			}
      if (inSequence)
        target[position++] = 0
		} else {
			position += target.utf8Write(key, position, 2000)
      if (inSequence)
        target[position++] = 0
		}
    break
	case 'number':
		float64Array[0] = key
		let lowInt = int32Array[0]
		let highInt = int32Array[1]
		let length
    let targetView = target.dataView || (target.dataView = new DataView(target.buffer, target.byteOffset, ((target.byteLength + 3) >> 2) << 2))
		if (key < 0) {
			target[position + 8] = (~(lowInt & 0xf)) << 4
			targetView.setInt32(position + 4, ~((lowInt >>> 4) | (highInt << 28)))
			targetView.setInt32(position + 0, (highInt ^ 0x7fffffff) >>> 4)
      return position + 9
		} else if (lowInt & 0xf || inSequence) {
			target[position + 8] = (lowInt & 0xf) << 4
			length = 9
		} else if (lowInt & 0xfff)
			length = 8
		else
			length = 6
		// switching order to go to little endian
		targetView.setInt32(position + 4, (lowInt >>> 4) | (highInt << 28))
		targetView.setInt32(position + 0, (highInt >>> 4) | 0x10000000)
		return position + length;
	case 'object':
		if (key) {
			if (key instanceof Array) {
				for (let i = 0, l = key.length; i < l; i++) {
					position = writeKey(key[i], target, position, i < l - 1)
				}
			} else if (key instanceof Uint8Array) {
				target.set(position, key)
				return position + key.length
			} else {
        throw new Error('Unable to serialize object as a key')
      }
		} else // null
			target[position++] = 5
	case 'boolean':
		target[position++] = key ? 7 : 6
    break
	case 'bigint':
		return writeKey(Number(key), target, position)
	case 'undefined': break
    // undefined is interpreted as the absence of a key, signified by zero length
  case 'symbol':
    target[position++] = 2
    return writeKey(key.description, target, position, inSequence)
  default:
    throw new Error('Can not serialize key of type ' + typeof key)
  }

	return position
}
let position
function readKey(buffer, start, end) {
  position = start
  let controlByte = buffer[position]
  let value
  if (controlByte < 24) {
    if (controlByte < 8) {
      position++
      if (controlByte == 6) {
        value = false
      } else if (controlByte == 7) {
        value = true
      } else if (controlByte == 0) {
        value = null
      } else if (controlByte == 2) {
        value = Symbol.for(readKey(buffer, position, end))
      } else
        return buffer
    } else {
      let dataView = buffer.dataView || (buffer.dataView = new DataView(buffer.buffer, buffer.byteOffset, ((buffer.byteLength + 3) >> 2) << 2))
      let highInt = dataView.getInt32(position) << 4
      let size = end - position
      let lowInt
      if (size > 4) {
        lowInt = dataView.getInt32(position + 4)
        highInt |= lowInt >>> 28
        if (size < 6) {
          lowInt &= -0x7fff0000
        }
        lowInt = lowInt << 4
        if (size > 8) {
          lowInt = lowInt | buffer[position + 8] >> 4
        }
      } else
        lowInt = 0
      if (controlByte < 16) {
        // negative gets negated
        highInt = highInt ^ 0x7fffffff
        lowInt = ~lowInt
      }
      int32Array[1] = highInt
      int32Array[0] = lowInt
      value = float64Array[0]
      position += 9
    }
  } else {
    if (controlByte == 27) {
      position++
    }
    value = readString(buffer)
    /*let strStart = position
    let strEnd = end
    for (; position < end; position++) {
      if (buffer[position] == 0) {
        break
      }
    }
    value = buffer.toString('utf8', strStart, position++)*/
  }
  if (position < end) {
    if (buffer[position] === 0)
      position++
    let nextValue = readKey(buffer, position, end)
    if (nextValue instanceof Array) {
      nextValue.unshift(value)
      return nextValue
    } else
      return [value, nextValue]
  }
  return value
}
exports.writeKey = writeKey
exports.readKey = readKey
exports.toBufferKey = (key) => {
  let buffer = Buffer.alloc(2048)
  return buffer.slice(0, writeKey(key, buffer, 0) + 1)
}
exports.fromBufferKey = (sourceBuffer) => {
  return readKey(sourceBuffer, 0, sourceBuffer.length - 1)
}
const fromCharCode = String.fromCharCode
function readNullTermString(buffer, position) {
  let a = buffer[position++]
  if (a === 0)
    return fromCharCode()
  else if (a >= 0x80)
    a = finishUtf8(position)

}
function makeStringBuilder() {
  let stringBuildCode = '(source) => {'
  let previous = []
  for (let i = 0; i < 0x20; i++) {
    v = fromCharCode((i & 0xf) + 97) + fromCharCode((i >> 4) + 97)
    stringBuildCode += `
  let ${v} = source[position++]
  if (${v} === 0)
    return fromCharCode(${previous})
  else if (${v} >= 0x80)
    ${v} = finishUtf8(${v}, source)
`
    previous.push(v)
  }
  stringBuildCode += `return fromCharCode(${previous}) + readString(source)}`
  return stringBuildCode
}

let pendingSurrogate
function finishUtf8(byte1, src) {
    if ((byte1 & 0xe0) === 0xc0) {
      // 2 bytes
      const byte2 = src[position++] & 0x3f
      return ((byte1 & 0x1f) << 6) | byte2
    } else if ((byte1 & 0xf0) === 0xe0) {
      // 3 bytes
      const byte2 = src[position++] & 0x3f
      const byte3 = src[position++] & 0x3f
      return ((byte1 & 0x1f) << 12) | (byte2 << 6) | byte3
    } else if ((byte1 & 0xf8) === 0xf0) {
      // 4 bytes
      if (pendingSurrogate) {
        byte1 = pendingSurrogate
        pendingSurrogate = null
        position += 3
        return byte1
      }
      const byte2 = src[position++] & 0x3f
      const byte3 = src[position++] & 0x3f
      const byte4 = src[position++] & 0x3f
      let unit = ((byte1 & 0x07) << 0x12) | (byte2 << 0x0c) | (byte3 << 0x06) | byte4
      if (unit > 0xffff) {
        unit -= 0x10000
        unit = 0xdc00 | (unit & 0x3ff)
        pendingSurrogate = ((unit >>> 10) & 0x3ff) | 0xd800
        position -= 4 // reset so we can return the next part of the surrogate pair
      }
      return unit
    } else {
      return byte1
    }
}

function swap64Bit(buffer, start, end) {
  let dataView = buffer.dataView || (buffer.dataView = new DataView(buffer.buffer, buffer.byteOffset, ((buffer.byteLength + 3) >> 2) << 2))
  let end64Bit = end & 0xffffff8
  for (;start < end64Bit; start += 8) {
    dataView.setBigUint64(start, dataView.getBigUint64(start), true)
  }
  dataView.setBigUint64(start, dataView.getBigUint64(start) >> ((8n - BigInt(end - start)) << 3n), true)
}
exports.swap64Bit = swap64Bit

function swap32Bit(buffer, start, end) {
  let dataView = buffer.dataView || (buffer.dataView = new DataView(buffer.buffer, buffer.byteOffset, ((buffer.byteLength + 3) >> 2) << 2))
  let end64Bit = end & 0xffffffc
  for (;start < end64Bit; start += 4) {
    dataView.setUint32(start, dataView.getUint32(start), true)
  }
  dataView.setUint32(start, dataView.getUint32(start) >>> ((4 - (end - start)) << 3), true)
}
exports.swap32Bit = swap32Bit

const readString = eval(makeStringBuilder())
