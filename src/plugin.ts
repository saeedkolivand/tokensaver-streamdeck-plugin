import streamDeck from "@elgato/streamdeck";

import { TokenSavings } from "./token-savings";

streamDeck.actions.registerAction(new TokenSavings());

streamDeck.connect();
