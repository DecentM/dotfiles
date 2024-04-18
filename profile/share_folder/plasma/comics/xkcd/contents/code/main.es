/*
 *   Copyright (C) 2007 Tobias Koenig <tokoe@kde.org>
 *   Copyright (C) 2009 - 2017 Matthias Fuchs <mat69@gmx.net>
 *   Copyright (C) 2019 Hans-Peter Jansen <hpj@urpla.net>
 *   Copyright (C) 2021 Mike Vastola <mike@vasto.la>
 *
 *   This program is free software; you can redistribute it and/or modify
 *   it under the terms of the GNU Library General Public License version 2 as
 *   published by the Free Software Foundation
 *
 *   This program is distributed in the hope that it will be useful,
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *   GNU General Public License for more details
 *
 *   You should have received a copy of the GNU Library General Public
 *   License along with this program; if not, write to the
 *   Free Software Foundation, Inc.,
 *   51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
 */

function init()
{
    comic.comicAuthor = "Randall Munroe";
    comic.websiteUrl= "https://xkcd.com/";
    comic.shopUrl = "https://store.xkcd.com/";

    comic.firstIdentifier = 1;

    comic.currentDataUrlId = 256;
    comic.lastDataUrlId = 257;
    if (!comic.lastIdentifier || !comic.identifierSpecified) {
        // Even if comic.identifierSpecified is true, if comic.lastIdentifier isn't set, we need to fetch it, so do that first.
        //  We'll know if we need to go to a different comic by if comic.identifierSpecified is set after we get results.
        print("Requesting data for latest comic from https://xkcd.com/info.0.json");
        comic.requestPage('https://xkcd.com/info.0.json', comic.lastDataUrlId);
    } else {
        // this should only run if there is a last identifier and an identifier has been specified
        print("Requesting data for requested comic from https://xkcd.com/" + String(comic.identifier) + '/info.0.json');
        comic.requestPage('https://xkcd.com/' + String(comic.identifier) + '/info.0.json', comic.currentDataUrlId);
    }
}

function pageRetrieved(id, data, metadata) {

    if (id === comic.Image) {
        print("Received comic image data.");
        return;
    }

    print("Received data from the XKCD API with ID " + id);
    if (id !== comic.currentDataUrlId && id !== comic.lastDataUrlId) {
        print("This function not configured to handle responses with this ID (" + id + ")");
        if (id !== Comic.Image) print("Data returned: " + data);
        return;
    }

    // Now parse the comic's data
    var currentData;
    try {
        currentData = JSON.parse(data);
    } catch (ex) {
        print("Error encountered: " + ex)
        print("Failed to parse XKCD API data: " + data);
        comic.error();
        return;
    }
    print("Data parsed successfully: " + data);

    var urlBase = "https://xkcd.com/"
    // this is true if we fetched from the endpoint for the most recent comic
    if (id === comic.lastDataUrlId) comic.lastIdentifier = currentData.num;

    // if the user really wanted a specific comic (other than this one), we need to get it now
    if (id === comic.lastDataUrlId && comic.identifierSpecified && comic.identifier != currentData.num) {
        var apiUrl = urlBase + String(comic.identifier) + '/info.0.json';
        print("Requesting data for requested comic " + comic.identifier + " from " + apiUrl);
        comic.requestPage(apiUrl, comic.currentDataUrlId);
        return;
    }

    // if the URL requested was data for the comic the user wanted, we use the data we just got to process the request

    comic.identifier = currentData.num;
    comic.websiteUrl = urlBase + String(comic.identifier);
    comic.title = currentData.title;
    comic.additionalText = currentData.alt;
    // Now just send a request to fetch the image
    print("Requesting image for comic " + comic.identifier + " from " + currentData.img);
    comic.requestPage(currentData.img, comic.Image);
}
