/*
 *  Copyright 2025 Adobe Systems Incorporated
 */
package com.demo.core.models;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

import javax.annotation.PostConstruct;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class SiteFooterModel {

    @ValueMapValue
    private String tagline;

    @ValueMapValue
    private String email;

    @ValueMapValue
    private String addressLine1;

    @ValueMapValue
    private String addressLine2;

    @ValueMapValue
    private String phone;

    @ValueMapValue
    private String copyright;

    @ValueMapValue
    @Default(values = "footer")
    private String backgroundColor;

    @ValueMapValue
    private String hexColor;

    @ChildResource
    private List<SocialLink> socialLinks;

    @PostConstruct
    protected void init() {
        if (socialLinks == null) {
            socialLinks = Collections.emptyList();
        } else {
            socialLinks = socialLinks.stream()
                    .filter(SocialLink::isValid)
                    .collect(Collectors.toCollection(ArrayList::new));
        }
    }

    public String getTagline() { return tagline; }
    public String getEmail() { return email; }
    public String getAddressLine1() { return addressLine1; }
    public String getAddressLine2() { return addressLine2; }
    public String getPhone() { return phone; }
    public String getCopyright() { return copyright; }
    public String getBackgroundColor() { return backgroundColor; }
    public List<SocialLink> getSocialLinks() { return socialLinks; }

    public String getBackgroundStyle() {
        if ("other".equals(backgroundColor) && StringUtils.isNotBlank(hexColor)) {
            return "background-color: " + hexColor.trim() + ";";
        }
        return null;
    }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(tagline)
                || StringUtils.isNotBlank(email)
                || StringUtils.isNotBlank(addressLine1)
                || StringUtils.isNotBlank(phone)
                || StringUtils.isNotBlank(copyright)
                || (socialLinks != null && !socialLinks.isEmpty());
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class SocialLink {
        @ValueMapValue
        private String platform;
        @ValueMapValue
        private String url;

        public String getPlatform() { return platform; }
        public String getUrl() { return url; }

        public boolean isValid() {
            return StringUtils.isNotBlank(url);
        }
    }
}
