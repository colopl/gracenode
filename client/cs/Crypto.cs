using System;
using System.Net;
using System.Text;
using System.Collections;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Cryptography;

public class Crypto {
	
	private const int BLOCK_LEN = 16;
	private const int SEQ_LEN = 4;

	private byte[] _sessionId;
	private byte[] _cipherKey;
	private byte[] _cipherNonce;
	private byte[] _macKey;
	private uint _sequence;
	private int _cipherCounterSize { get; set; }
	private int _hashLength = 32;	

	public Crypto(Guid sessionId, byte[] cipherKey, byte[] cipherNonce, byte[] macKey) {
		if (cipherKey.Length != 16) {
			throw new System.ArgumentException("Chipher Key must be 16 bytes");
		}

		if (cipherNonce.Length != 8) {
			throw new System.ArgumentException("Chipher Nonce must be 8 bytes");
		}

		if (macKey.Length != 32) {
			throw new System.ArgumentException("Mac Key must be 32 bytes");
		}

		_sequence = 0;
		_sessionId = _TransposeGuidBytes(sessionId.ToByteArray());
		_cipherKey = cipherKey;
		_cipherNonce = cipherNonce;
		_macKey = macKey;

		if (_sessionId.Length != 16) {
			throw new System.ArgumentException("Session ID must be 16 bytes");
		}

		_cipherCounterSize = _cipherNonce.Length + sizeof(uint) + sizeof(uint);
	}

	public byte[] Encrypt(byte[] payload) {
		_sequence++;
		byte[] seqBytes = BitConverter.GetBytes(IPAddress.NetworkToHostOrder((int)_sequence));
		byte[] cipherBytes = new byte[payload.Length];
		byte[] outpacket = new byte[cipherBytes.Length + SEQ_LEN + _hashLength];

		_Ctr(_sequence, payload, cipherBytes, 0);

		Buffer.BlockCopy(seqBytes, 0, outpacket, 0, SEQ_LEN);
		Buffer.BlockCopy(cipherBytes, 0, outpacket, SEQ_LEN, cipherBytes.Length);

		byte[] payloadToSign = _ByteSlice(outpacket, 0, outpacket.Length - _hashLength);
		HMACSHA256 hashAlgorithm = new HMACSHA256(_macKey);
		byte[] hmac = hashAlgorithm.ComputeHash(payloadToSign);

		Buffer.BlockCopy(hmac, 0, outpacket, outpacket.Length - _hashLength, _hashLength);

		byte[] epacket = new byte[_sessionId.Length + SEQ_LEN + outpacket.Length];

		Buffer.BlockCopy(_sessionId, 0, epacket, 0, _sessionId.Length);
		Buffer.BlockCopy(seqBytes, 0, epacket, _sessionId.Length, SEQ_LEN);
		Buffer.BlockCopy(outpacket, 0, epacket, _sessionId.Length + SEQ_LEN, outpacket.Length);

		return epacket;
	}

	public byte[] Decrypt(byte[] payload) {
		byte[] payloadToSign = _ByteSlice(payload, 0, payload.Length - _hashLength);
		byte[] serverHmac = _ByteSlice(payload, payload.Length - _hashLength, payload.Length);
		HMACSHA256 hashAlgorithm = new HMACSHA256(_macKey);
		byte[] clientHmac = hashAlgorithm.ComputeHash(payloadToSign);

		if (!ByteEqual(serverHmac, clientHmac)) {
			throw new System.ArgumentException("Bad Signature");
		}

		byte[] eBytes = _ByteSlice(payload, SEQ_LEN, payload.Length - _hashLength);
		byte[] dBytes = new byte[eBytes.Length];

		// seq is always 0 from server
		uint seq = 0;
		_Ctr(seq, eBytes, dBytes, 0);

		return dBytes;	
	}

	private static byte[] _TransposeGuidBytes(byte[] buffIn) {
		byte[] buffOut = new byte[buffIn.Length];
		buffOut[3] = buffIn[0];
		buffOut[2] = buffIn[1];
		buffOut[1] = buffIn[2];
		buffOut[0] = buffIn[3];
		buffOut[5] = buffIn[4];
		buffOut[4] = buffIn[5];
		buffOut[7] = buffIn[6];
		buffOut[6] = buffIn[7];
		buffOut[8] = buffIn[8];
		buffOut[9] = buffIn[9];
		buffOut[10] = buffIn[10];
		buffOut[11] = buffIn[11];
		buffOut[12] = buffIn[12];
		buffOut[13] = buffIn[13];
		buffOut[14] = buffIn[14];
		buffOut[15] = buffIn[15];
		return buffOut;
	}

	private void _Ctr(uint seq, byte[] inBytes, byte[] outBytes, int offset) {
		// aes-128-ecb
		Aes aes = Aes.Create();
		aes.Mode = CipherMode.ECB;
		aes.Key = _cipherKey;
		ICryptoTransform cryptoAlgorithm = aes.CreateEncryptor();
		// prepare
		byte[] cipherCounter = new byte[_cipherCounterSize];
		Buffer.BlockCopy(_cipherNonce, 0, cipherCounter, 0, _cipherNonce.Length);
		//int count = (inBytes.Length + 15) / BLOCK_LEN;
		int count = (inBytes.Length + BLOCK_LEN) / BLOCK_LEN;
		byte[] ctrBytes = new byte[count * BLOCK_LEN];
		byte[] seqBytes = BitConverter.GetBytes(IPAddress.HostToNetworkOrder((int)seq));
		Buffer.BlockCopy(seqBytes, 0, cipherCounter, _cipherNonce.Length, SEQ_LEN);
		// count and transform
		for(int b = 0; b < count; b++) {
			byte[] blkBytes = BitConverter.GetBytes(IPAddress.HostToNetworkOrder(b));
			Buffer.BlockCopy(blkBytes, 0, cipherCounter, _cipherNonce.Length + blkBytes.Length, blkBytes.Length);
			cryptoAlgorithm.TransformBlock(cipherCounter, 0, BLOCK_LEN, ctrBytes, b * BLOCK_LEN);
		}
		// xor
		for(int i = 0; i < inBytes.Length; i++) {
			outBytes[offset + i] = (byte)(inBytes[i] ^ ctrBytes[i]);
		}
	}

	private byte[] _ByteSlice(byte[] source, int start, int end) {
		byte[] res = new byte[end - start];

		// handles negative end
		if (end < 0) {
			end = source.Length + end;
		}

		int len = end - start;

		for (int i = 0; i < len; i++) {
			res[i] = source[i + start];
		}

		return res;
	}

	private bool ByteEqual(byte[] a, byte[] b) {

		if (a.Length != b.Length) {
			return false;
		}

		int i = 0;
		int alen = a.Length;
		while (i < alen && (a[i] == b[i])) {
			i++;
		}

		if (i == alen) {
			return true;
		}

		return false;
	}

}
