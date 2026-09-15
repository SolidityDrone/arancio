import { Connection, PublicKey } from "@solana/web3.js";

export type AddressBook = {
  kaminoProgram: PublicKey;
  jupiterProgram: PublicKey;
  tokenProgram: PublicKey;
  token2022Program: PublicKey;
  associatedTokenProgram: PublicKey;
  frozen: boolean;
};

const ACCOUNT_DISCRIMINATOR_BYTES = 8;
const PUBLIC_KEY_BYTES = 32;
const ADDRESS_BOOK_BYTES =
  ACCOUNT_DISCRIMINATOR_BYTES + PUBLIC_KEY_BYTES * 6 + 1;

export async function loadAddressBook(
  connection: Connection,
  programId: PublicKey,
  addressBook: PublicKey
): Promise<AddressBook> {
  const account = await connection.getAccountInfo(addressBook, "confirmed");
  if (!account) {
    throw new Error(
      `address book account is missing: ${addressBook.toBase58()}`
    );
  }
  if (!account.owner.equals(programId)) {
    throw new Error(`address book is owned by an unexpected program`);
  }
  if (account.data.length < ADDRESS_BOOK_BYTES) {
    throw new Error("address book account has an invalid size");
  }

  let offset = ACCOUNT_DISCRIMINATOR_BYTES + PUBLIC_KEY_BYTES;
  const readPublicKey = () => {
    const value = new PublicKey(account.data.subarray(offset, offset + 32));
    offset += PUBLIC_KEY_BYTES;
    return value;
  };

  const result = {
    kaminoProgram: readPublicKey(),
    jupiterProgram: readPublicKey(),
    tokenProgram: readPublicKey(),
    token2022Program: readPublicKey(),
    associatedTokenProgram: readPublicKey(),
    frozen: account.data[offset] === 1,
  };

  if (!result.frozen) {
    throw new Error("address book is not frozen");
  }

  return result;
}
