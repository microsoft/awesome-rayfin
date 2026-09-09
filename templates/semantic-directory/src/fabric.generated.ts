//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import type { FabricConfig } from "@microsoft/fabric-app-data";

const PLACEHOLDER_GUID = "00000000-0000-0000-0000-000000000000";

export const fabricConfig = {
    semanticModels: {
        model: {
            workspaceId: PLACEHOLDER_GUID,
            itemId: PLACEHOLDER_GUID,
        },
    },
} satisfies FabricConfig;
